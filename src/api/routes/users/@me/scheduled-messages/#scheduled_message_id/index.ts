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
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Channel, ScheduledMessage, User } from "@spacebar/database";
import { scheduledMessageJSON, validateScheduledContent, validateScheduledSendAt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

async function findOwn(req: Request) {
    const scheduled = await ScheduledMessage.findOne({ where: { id: req.params.scheduled_message_id as string, user_id: req.user_id } });
    if (!scheduled) throw new HTTPError("Unknown scheduled message", 404);
    return scheduled;
}

router.patch("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const scheduled = await findOwn(req);
    const body = req.body ?? {};
    if (body.scheduled_timestamp != null) scheduled.send_at = validateScheduledSendAt(body.scheduled_timestamp);
    if (body.content != null || body.flags != null) {
        scheduled.payload = { ...scheduled.payload, content: body.content ?? scheduled.payload.content, flags: body.flags ?? scheduled.payload.flags };
        validateScheduledContent(scheduled.payload);
    }
    await scheduled.save();
    const channel = await Channel.findOne({ where: { id: scheduled.channel_id }, select: { id: true, guild_id: true } });
    res.json(scheduledMessageJSON(scheduled, await User.findOneOrFail({ where: { id: req.user_id } }), channel?.guild_id));
});

router.delete("/", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const scheduled = await findOwn(req);
    await ScheduledMessage.delete({ id: scheduled.id });
    res.sendStatus(204);
});

export default router;
