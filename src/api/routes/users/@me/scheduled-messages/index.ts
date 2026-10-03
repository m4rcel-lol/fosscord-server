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
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Channel, ScheduledMessage, ScheduledMessagePayload, ScheduledMessageState, User } from "@spacebar/database";
import { DiscordApiErrors, getPermission, SCHEDULED_MESSAGE_LIMIT } from "@spacebar/util";
import { assertCanSendDirectMessage, scheduledMessageJSON, validateScheduledContent, validateScheduledSendAt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const scheduled = await ScheduledMessage.find({ where: { user_id: req.user_id }, order: { send_at: "ASC" } });
    const channels = scheduled.length ? await Channel.find({ where: { id: In([...new Set(scheduled.map((s) => s.channel_id))]) }, select: { id: true, guild_id: true } }) : [];
    const guilds = new Map(channels.map((c) => [c.id, c.guild_id]));
    const author = await User.findOneOrFail({ where: { id: req.user_id } });
    res.json(scheduled.map((s) => scheduledMessageJSON(s, author, guilds.get(s.channel_id))));
});

router.post("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const channel = await Channel.findOne({ where: { id: String(body.channel_id) }, relations: { recipients: { user: true } } });
    if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    const permission = await getPermission(req.user_id, channel.guild_id ?? undefined, channel);
    permission.hasThrow("VIEW_CHANNEL");
    permission.hasThrow(channel.isThread() ? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES");
    if (!channel.isWritable()) throw new HTTPError(`Cannot send messages to channel of type ${channel.type}`, 400);
    await assertCanSendDirectMessage(channel, req.user_id);

    if ((await ScheduledMessage.count({ where: { user_id: req.user_id, state: ScheduledMessageState.SCHEDULED } })) >= SCHEDULED_MESSAGE_LIMIT)
        throw new HTTPError(`Maximum number of scheduled messages reached (${SCHEDULED_MESSAGE_LIMIT})`, 400);

    const payload: ScheduledMessagePayload = {
        content: body.content ?? "",
        flags: body.flags ?? 0,
        message_reference: body.message_reference ?? undefined,
        allowed_mentions: body.allowed_mentions ?? undefined,
        sticker_ids: body.sticker_ids ?? undefined,
        poll: body.poll ?? undefined,
        attachments: (body.attachments ?? []).filter((a: { uploaded_filename?: string }) => a?.uploaded_filename),
    };
    validateScheduledContent(payload);
    const scheduled = await ScheduledMessage.create({
        user_id: req.user_id,
        channel_id: channel.id,
        send_at: validateScheduledSendAt(body.scheduled_timestamp),
        payload,
        state: ScheduledMessageState.SCHEDULED,
    }).save();
    res.json(scheduledMessageJSON(scheduled, await User.findOneOrFail({ where: { id: req.user_id } }), channel.guild_id));
});

export default router;
