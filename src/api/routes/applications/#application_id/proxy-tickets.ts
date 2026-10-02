/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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
import { route } from "@spacebar/api/middlewares";
import { Channel, EmbeddedActivity } from "@spacebar/database";
import { DiscordApiErrors, getPermission } from "@spacebar/util";
import { signProxyTicket } from "@spacebar/api/activities";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const applicationId = req.params.application_id as string;
    if (!(await EmbeddedActivity.exists({ where: { application_id: applicationId } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const { channel_id } = (req.body ?? {}) as { channel_id?: string };
    if (typeof channel_id === "string") {
        const channel = await Channel.findOne({ where: { id: channel_id }, relations: { recipients: true } });
        if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        (await getPermission(req.user_id, channel.guild_id ?? undefined, channel)).hasThrow("VIEW_CHANNEL");
    }
    res.json({ ticket: signProxyTicket(req.user_id, applicationId, typeof channel_id === "string" ? channel_id : undefined) });
});

export default router;
