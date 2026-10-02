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
import { route } from "@spacebar/api/middlewares";
import { handleMessage, postHandleMessage } from "@spacebar/api/util";
import { Channel, Message, Webhook } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, MessageCreateEvent, MessageFlags, MessageUpdateEvent, Snowflake } from "@spacebar/util";
import { ChannelType, MessageType, WebhookType } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            200: {
                body: "PublicMessage",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, message_id } = req.params as Record<string, string>;
        const channel = await Channel.findOneOrFail({ where: { id: channel_id } });
        if (channel.type !== ChannelType.GUILD_NEWS) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;

        const message = await Message.findOneOrFail({
            where: { id: message_id, channel_id },
            relations: { author: true, attachments: true, sticker_items: true, mentions: true, mention_roles: true },
        });
        req.permission!.hasThrow(message.author_id === req.user_id ? "SEND_MESSAGES" : "MANAGE_MESSAGES");
        if (message.flags & Number(MessageFlags.FLAGS.CROSSPOSTED)) throw DiscordApiErrors.ALREADY_CROSSPOSTED;
        if (message.type !== MessageType.DEFAULT && message.type !== MessageType.REPLY) throw DiscordApiErrors.CANNOT_EXECUTE_ON_SYSTEM_MESSAGE;

        message.flags |= Number(MessageFlags.FLAGS.CROSSPOSTED);
        await Message.update({ id: message.id }, { flags: message.flags });
        await emitEvent({ event: "MESSAGE_UPDATE", channel_id, data: message.toJSON() } satisfies MessageUpdateEvent);

        const followers = await Webhook.find({ where: { type: WebhookType.ChannelFollower, source_channel_id: channel_id } });
        for (const webhook of followers) {
            try {
                const copy = await handleMessage({
                    id: Snowflake.generate(),
                    content: message.content,
                    embeds: message.embeds ?? [],
                    sticker_ids: message.sticker_items?.map((s) => s.id),
                    type: MessageType.DEFAULT,
                    flags: Number(MessageFlags.FLAGS.IS_CROSSPOST),
                    pinned: false,
                    webhook_id: webhook.id,
                    username: webhook.name,
                    channel_id: webhook.channel_id,
                    message_reference: { message_id: message.id, channel_id, guild_id: channel.guild_id },
                    allowed_mentions: { parse: [] },
                    attachments: [],
                    timestamp: new Date(),
                });
                await copy.save();
                await emitEvent({ event: "MESSAGE_CREATE", channel_id: webhook.channel_id, data: copy.toJSON() } satisfies MessageCreateEvent);
                postHandleMessage(copy).catch((e) => console.error("[Crosspost] post-message handler failed", e));
            } catch (e) {
                console.error(`[Crosspost] failed to deliver ${message.id} to webhook ${webhook.id}`, e);
            }
        }

        return res.json(message.toJSON());
    },
);

export default router;
