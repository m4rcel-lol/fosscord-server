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
import { Channel, Recipient } from "@spacebar/database";
import { ChannelDeleteEvent, DmChannelDTO, emitEvent } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.put(
    "/",
    route({
        responses: {
            204: {},
        },
    }),
    async (req: Request, res: Response) => {
        const ids = (Array.isArray(req.body?.channel_ids) ? req.body.channel_ids : []).map(String).slice(0, 100);
        const recipients = ids.length ? await Recipient.find({ where: { user_id: req.user_id, channel_id: In(ids) }, relations: { channel: { recipients: true } } }) : [];
        for (const recipient of recipients.filter((r) => r.channel.type === ChannelType.DM)) {
            recipient.closed = true;
            recipient.message_request_timestamp = null;
            await Recipient.update({ id: recipient.id }, { closed: true, message_request_timestamp: null });
            await emitEvent({
                event: "CHANNEL_DELETE",
                data: await DmChannelDTO.from(recipient.channel as Channel, [req.user_id]),
                user_id: req.user_id,
            } as ChannelDeleteEvent);
        }
        res.sendStatus(204);
    },
);

export default router;
