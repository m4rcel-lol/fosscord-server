/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { E2eeErrors, e2eeRateLimit, isE2eeChannelType } from "@spacebar/api/util";
import { Channel, E2eeDevice } from "@spacebar/database";
import { ChannelE2eeResponse, ChannelE2eeUpdateSchema } from "@spacebar/schemas";
import { emitEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

const toResponse = (channel: Channel): ChannelE2eeResponse => ({
    channel_id: channel.id,
    enabled: channel.e2ee_enabled_at != null,
    enabled_at: channel.e2ee_enabled_at?.toISOString() ?? null,
});

router.get(
    "/",
    route({
        spacebarOnly: true,
        permission: "VIEW_CHANNEL",
        responses: { 200: { body: "ChannelE2eeResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const channel = await Channel.findOneOrFail({ where: { id: channel_id } });
        res.json(toResponse(channel));
    },
);

router.put(
    "/",
    e2eeRateLimit("e2ee_channel", 10, 60),
    route({
        spacebarOnly: true,
        permission: "VIEW_CHANNEL",
        requestBody: "ChannelE2eeUpdateSchema",
        responses: { 200: { body: "ChannelE2eeResponse" }, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const { enabled } = req.body as ChannelE2eeUpdateSchema;
        const channel = await Channel.findOneOrFail({ where: { id: channel_id }, relations: { recipients: true } });
        if (!isE2eeChannelType(channel.type)) throw E2eeErrors.UNSUPPORTED;
        if (!enabled) {
            if (channel.e2ee_enabled_at) throw E2eeErrors.CANNOT_DISABLE;
            return res.json(toResponse(channel));
        }
        if (channel.e2ee_enabled_at) return res.json(toResponse(channel));

        const members = channel.recipients?.map((r) => r.user_id) ?? [];
        const devices = await E2eeDevice.find({ where: { user_id: In(members), status: "active" }, select: { user_id: true } });
        if (members.some((id) => !devices.some((d) => d.user_id === id))) throw E2eeErrors.RECIPIENT_NO_DEVICES;

        channel.e2ee_enabled_at = new Date();
        await Channel.update({ id: channel.id }, { e2ee_enabled_at: channel.e2ee_enabled_at });
        const data = { ...toResponse(channel), user_id: req.user_id };
        await Promise.all(members.map((id) => emitEvent({ event: "CHANNEL_E2EE_UPDATE", user_id: id, data })));
        res.json(toResponse(channel));
    },
);

export default router;
