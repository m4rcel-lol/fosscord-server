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
import { IsNull, LessThan, Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Message, User } from "@spacebar/database";
import { ChannelPinsUpdateEvent, Config, DiscordApiErrors, emitEvent, MessageCreateEvent, MessageUpdateEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.put(
    "/:message_id",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            204: {},
            403: {},
            404: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, message_id } = req.params as { [key: string]: string };

        const message = await Message.findOneOrFail({
            where: { id: message_id, channel_id },
            relations: { author: true },
        });

        // * in dm channels anyone can pin messages -> only check for guilds
        if (message.guild_id) req.permission?.hasThrow("MANAGE_MESSAGES");
        if (message.pinned_at) return res.sendStatus(204);

        const pinned_count = await Message.count({
            where: { channel: { id: channel_id }, pinned_at: Not(IsNull()) },
        });

        const { maxPins } = Config.get().limits.channel;
        if (pinned_count >= maxPins) throw DiscordApiErrors.MAXIMUM_PINS.withParams(maxPins);

        message.pinned_at = new Date();

        const author = await User.getPublicUser(req.user_id);

        const systemPinMessage = Message.create({
            timestamp: new Date(),
            type: 6,
            guild_id: message.guild_id,
            channel_id: message.channel_id,
            author,
            message_reference: {
                message_id: message.id,
                channel_id: message.channel_id,
                guild_id: message.guild_id,
            },
            reactions: [],
            attachments: [],
            embeds: [],
            sticker_items: [],
            edited_timestamp: undefined,
            mentions: [],
            mention_channels: [],
            mention_roles: [],
            mention_everyone: false,
        });

        await message.save();
        const publicMsg = message.toJSON();
        const publicSystem = systemPinMessage.toJSON();
        await Promise.all([
            emitEvent({
                event: "MESSAGE_UPDATE",
                channel_id,
                data: publicMsg,
            } satisfies MessageUpdateEvent),
            emitEvent({
                event: "CHANNEL_PINS_UPDATE",
                channel_id,
                data: {
                    channel_id,
                    guild_id: message.guild_id,
                    last_pin_timestamp: message.pinned_at.toISOString(),
                },
            } satisfies ChannelPinsUpdateEvent),
            systemPinMessage.save(),
            emitEvent({
                event: "MESSAGE_CREATE",
                channel_id: message.channel_id,
                data: publicSystem,
            } satisfies MessageCreateEvent),
        ]);

        res.sendStatus(204);
    },
);

router.delete(
    "/:message_id",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            204: {},
            403: {},
            404: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, message_id } = req.params as { [key: string]: string };

        const message = await Message.findOneOrFail({
            where: { id: message_id, channel_id },
            relations: { author: true },
        });

        if (message.guild_id) req.permission?.hasThrow("MANAGE_MESSAGES");
        if (!message.pinned_at) return res.sendStatus(204);

        message.pinned_at = null;

        await message.save();
        const publicMsg2 = message.toJSON();
        await Promise.all([
            emitEvent({
                event: "MESSAGE_UPDATE",
                channel_id,
                data: publicMsg2,
            } satisfies MessageUpdateEvent),
            emitEvent({
                event: "CHANNEL_PINS_UPDATE",
                channel_id,
                data: {
                    channel_id,
                    guild_id: message.guild_id,
                    last_pin_timestamp: (await Message.findOne({ where: { channel_id, pinned_at: Not(IsNull()) }, order: { pinned_at: "DESC" } }))?.pinned_at?.toISOString(),
                },
            } satisfies ChannelPinsUpdateEvent),
        ]);

        res.sendStatus(204);
    },
);

router.get(
    "/",
    route({
        permission: ["READ_MESSAGE_HISTORY"],
        query: {
            before: { type: "string" },
            limit: { type: "number" },
        },
        responses: {
            200: {
                body: "PublicMessageListResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };

        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 50);
        const before = req.query.before ? new Date(`${req.query.before}`) : undefined;
        const pins = await Message.find({
            where: { channel_id: channel_id, pinned_at: before && !isNaN(before.getTime()) ? LessThan(before) : Not(IsNull()) },
            take: limit + 1,
            relations: {
                author: true,
                webhook: true,
                application: true,
                mentions: true,
                mention_roles: true,
                mention_channels: true,
                sticker_items: true,
                attachments: true,
                thread: {
                    recipients: {
                        user: true,
                    },
                },
            },
            order: { pinned_at: "DESC" },
        });
        const has_more = pins.length > limit;
        pins.splice(limit);
        await Message.fillReplies(pins);

        const items = pins.map((message: Message) => ({
            message: { ...message.toJSON(), reactions: Message.publicReactions(message.reactions, req.user_id) },
            pinned_at: message.pinned_at,
        }));

        res.send({
            items,
            has_more,
        });
    },
);

export default router;
