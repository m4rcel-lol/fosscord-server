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
import { IsNull, Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Message, SavedMessage } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, FieldErrors, MESSAGE_REMINDER_LIMIT, SAVED_MESSAGE_LIMIT } from "@spacebar/util";
import { canReadMessage, savedMessageRelations, savedMessageResult } from "@spacebar/api/util/handlers/SavedMessages";

const router = Router({ mergeParams: true });

router.put("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { channel_id, message_id } = req.params as { [key: string]: string };
    const message = await Message.findOne({ where: { id: message_id, channel_id }, relations: savedMessageRelations });
    if (!message || !(await canReadMessage(req.user_id, message))) throw DiscordApiErrors.UNKNOWN_MESSAGE;

    const rawDue = req.body?.due_at;
    const due_at = rawDue == null ? null : new Date(rawDue);
    if (due_at && (Number.isNaN(due_at.getTime()) || due_at.getTime() <= Date.now()))
        throw FieldErrors({ due_at: { code: "BASE_TYPE_INVALID", message: "Reminders must be set in the future." } });

    const existing = await SavedMessage.findOne({ where: { user_id: req.user_id, message_id } });
    if (!existing && (await SavedMessage.count({ where: { user_id: req.user_id } })) >= SAVED_MESSAGE_LIMIT)
        throw new HTTPError(`Maximum number of saved messages reached (${SAVED_MESSAGE_LIMIT})`, 400);
    if (due_at && !existing?.due_at && (await SavedMessage.count({ where: { user_id: req.user_id, due_at: Not(IsNull()) } })) >= MESSAGE_REMINDER_LIMIT)
        throw new HTTPError(`Maximum number of reminders reached (${MESSAGE_REMINDER_LIMIT})`, 400);

    const saved = existing ?? SavedMessage.create({ user_id: req.user_id, channel_id, message_id, saved_at: new Date(), notes: null });
    saved.due_at = due_at;
    await saved.save();

    const result = savedMessageResult(saved, message, req.user_id);
    await emitEvent({ event: "SAVED_MESSAGE_CREATE", user_id: req.user_id, data: result });
    res.json(result);
});

router.delete("/", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    const { channel_id, message_id } = req.params as { [key: string]: string };
    const { affected } = await SavedMessage.delete({ user_id: req.user_id, message_id });
    if (affected) await emitEvent({ event: "SAVED_MESSAGE_DELETE", user_id: req.user_id, data: { channel_id, message_id } });
    res.sendStatus(204);
});

export default router;
