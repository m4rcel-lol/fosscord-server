/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2025 Spacebar and Spacebar Contributors

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
import { assertCanSendDirectMessage, handleMessage, postHandleMessage, reopenDirectMessage } from "@spacebar/api/util";
import { Channel, Message, ReadState } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, MessageCreateEvent } from "@spacebar/util";
import { GreetRequestSchema, MessageType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "GreetRequestSchema",
        permission: "SEND_MESSAGES",
        responses: {
            200: {
                body: "PublicMessage",
            },
            404: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const payload = req.body as GreetRequestSchema;
        const { channel_id } = req.params as { [key: string]: string };

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { recipients: true },
        });

        if (payload.sticker_ids?.length !== 1)
            return res.status(400).json({
                code: 50035,
                message: "Must include exactly one sticker.",
            });

        const reference = payload.message_reference?.message_id
            ? { message_id: payload.message_reference.message_id, channel_id, guild_id: channel.guild_id ?? undefined, type: 0 }
            : undefined;

        if (reference) {
            const target = await Message.findOne({ where: { id: reference.message_id, channel_id }, select: { id: true, type: true } });
            if (!target) throw DiscordApiErrors.UNKNOWN_MESSAGE;
            if (!channel.isDm() && target.type !== MessageType.GUILD_MEMBER_JOIN) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
        } else if (!channel.isDm()) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;

        await assertCanSendDirectMessage(channel, req.user_id);

        const message = await handleMessage({
            channel_id,
            author_id: req.user_id,
            type: MessageType.DEFAULT,
            sticker_ids: payload.sticker_ids,
            allowed_mentions: payload.allowed_mentions,
            message_reference: reference,
            timestamp: new Date(),
        });

        await reopenDirectMessage(channel, req.user_id);

        const readState = (await ReadState.findOne({ where: { user_id: req.user_id, channel_id } })) ?? ReadState.create({ user_id: req.user_id, channel_id });
        readState.last_message_id = message.id;
        readState.mention_count = 0;

        await message.save();
        await Promise.all([
            readState.save(),
            emitEvent({
                event: "MESSAGE_CREATE",
                channel_id,
                data: message.toJSON(),
            } satisfies MessageCreateEvent),
        ]);
        postHandleMessage(message).catch((e) => console.error("[Greet] post-message handler failed", e));

        res.json(message.toJSON());
    },
);

export default router;
