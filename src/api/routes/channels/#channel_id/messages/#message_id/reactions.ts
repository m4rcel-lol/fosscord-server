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
import { In, MoreThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { getBurstColors } from "@spacebar/api/util";
import { Channel, Emoji, Member, Message, User } from "@spacebar/database";
import {
    emitEvent,
    getPermission,
    MessageReactionAddEvent,
    MessageReactionRemoveAllEvent,
    MessageReactionRemoveEmojiEvent,
    MessageReactionRemoveEvent,
    ReactionType,
} from "@spacebar/util";
import { PartialEmoji, PublicMemberProjection, PublicUserProjection, Reaction } from "@spacebar/schemas";

const router = Router({ mergeParams: true });
// TODO: check if emoji is really an unicode emoji or a properly encoded external emoji

function getEmoji(emoji: string): PartialEmoji {
    emoji = decodeURIComponent(emoji);
    const parts = emoji.includes(":") && emoji.split(":");
    if (parts)
        return {
            name: parts[0],
            id: parts[1],
        };

    return {
        id: undefined,
        name: emoji,
    };
}

const getType = (value: unknown, burst?: unknown): ReactionType => (Number(value) === ReactionType.burst || burst === "true" ? ReactionType.burst : ReactionType.normal);

const findReaction = (reactions: Reaction[], emoji: PartialEmoji) => reactions.find((x) => (emoji.id ? x.emoji.id === emoji.id : !x.emoji.id && x.emoji.name === emoji.name));

const usersOf = (reaction: Reaction, type: ReactionType) => (type === ReactionType.burst ? (reaction.burst_user_ids ??= []) : reaction.user_ids);

const recount = (reaction: Reaction) => (reaction.count = reaction.user_ids.length + (reaction.burst_user_ids?.length ?? 0));

async function removeReaction(req: Request, res: Response, type: ReactionType) {
    let { user_id } = req.params as { [key: string]: string };
    const { message_id, channel_id } = req.params as { [key: string]: string };
    const emoji = getEmoji(req.params.emoji as string);

    const channel = await Channel.findOneOrFail({ where: { id: channel_id } });
    const message = await Message.findOneOrFail({ where: { id: message_id, channel_id } });

    if (user_id === "@me") user_id = req.user_id;
    else if (user_id !== req.user_id) (await getPermission(req.user_id, undefined, channel_id)).hasThrow("MANAGE_MESSAGES");

    const reaction = findReaction(message.reactions, emoji);
    const users = reaction && usersOf(reaction, type);
    if (!reaction || !users?.includes(user_id)) throw new HTTPError("Reaction not found", 404);

    users.splice(users.indexOf(user_id), 1);
    if (!recount(reaction)) message.reactions.splice(message.reactions.indexOf(reaction), 1);

    await Message.update({ id: message.id, channel_id }, { reactions: message.reactions });

    await emitEvent({
        event: "MESSAGE_REACTION_REMOVE",
        channel_id,
        data: {
            user_id,
            channel_id,
            message_id,
            guild_id: channel.guild_id,
            emoji: reaction.emoji,
            burst: type === ReactionType.burst,
            type,
        },
    } satisfies MessageReactionRemoveEvent);

    res.sendStatus(204);
}

router.delete(
    "/",
    route({
        permission: "MANAGE_MESSAGES",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { message_id, channel_id } = req.params as { [key: string]: string };

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
        });

        await Message.update({ id: message_id, channel_id }, { reactions: [] });

        await emitEvent({
            event: "MESSAGE_REACTION_REMOVE_ALL",
            channel_id,
            data: {
                channel_id,
                message_id,
                guild_id: channel.guild_id,
            },
        } satisfies MessageReactionRemoveAllEvent);

        res.sendStatus(204);
    },
);

router.delete(
    "/:emoji",
    route({
        permission: "MANAGE_MESSAGES",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { message_id, channel_id } = req.params as { [key: string]: string };
        const emoji = getEmoji(req.params.emoji as string);

        const message = await Message.findOneOrFail({
            where: { id: message_id, channel_id },
        });

        const reaction = findReaction(message.reactions, emoji);
        if (!reaction) throw new HTTPError("Reaction not found", 404);
        message.reactions.splice(message.reactions.indexOf(reaction), 1);

        await Promise.all([
            Message.update({ id: message.id, channel_id }, { reactions: message.reactions }),
            emitEvent({
                event: "MESSAGE_REACTION_REMOVE_EMOJI",
                channel_id,
                data: {
                    channel_id,
                    message_id,
                    guild_id: message.guild_id,
                    emoji: reaction.emoji,
                },
            } satisfies MessageReactionRemoveEmojiEvent),
        ]);

        res.sendStatus(204);
    },
);

router.get(
    "/:emoji",
    route({
        permission: "VIEW_CHANNEL",
        query: {
            limit: { type: "number" },
            after: { type: "string" },
            type: { type: "number" },
        },
        responses: {
            200: {
                body: "PublicUser",
            },
            400: {
                body: "APIErrorResponse",
            },
            404: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { message_id, channel_id } = req.params as { [key: string]: string };
        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const emoji = getEmoji(req.params.emoji as string);
        const type = getType(req.query.type, req.query.burst);

        const message = await Message.findOneOrFail({
            where: { id: message_id, channel_id },
        });
        const reaction = findReaction(message.reactions, emoji);
        if (!reaction) throw new HTTPError("Reaction not found", 404);

        const after = req.query.after ? `${req.query.after}` : undefined;
        const ids = usersOf(reaction, type).filter((id) => !after || BigInt(id) > BigInt(after));
        if (!ids.length) return res.json([]);

        const users = await User.find({ where: { id: In(ids) }, order: { id: "ASC" }, take: limit });
        res.json(users.map((user) => user.toPublicUser()));
    },
);

router.put(
    "/:emoji/:user_id",
    route({
        permission: "READ_MESSAGE_HISTORY",
        right: "SELF_ADD_REACTIONS",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { message_id, channel_id, user_id } = req.params as { [key: string]: string };
        if (user_id !== "@me") throw new HTTPError("Invalid user");
        const emoji = getEmoji(req.params.emoji as string);
        const type = getType(req.query.type, req.query.burst);

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
        });
        const message = await Message.findOneOrFail({
            where: { id: message_id, channel_id },
        });
        let reaction = findReaction(message.reactions, emoji);

        if (!reaction) req.permission?.hasThrow("ADD_REACTIONS");

        if (emoji.id) {
            const external_emoji = await Emoji.findOneOrFail({
                where: { id: emoji.id },
            });
            if (!reaction && channel.guild_id != external_emoji.guild_id) req.permission?.hasThrow("USE_EXTERNAL_EMOJIS");
            emoji.animated = external_emoji.animated;
            emoji.name = external_emoji.name;
        }

        if (!reaction) {
            reaction = { count: 0, emoji, user_ids: [], burst_user_ids: [], burst_colors: [] };
            message.reactions.push(reaction);
        }
        const users = usersOf(reaction, type);
        if (users.includes(req.user_id)) return res.sendStatus(204);
        users.push(req.user_id);
        recount(reaction);
        if (type === ReactionType.burst && !reaction.burst_colors?.length) reaction.burst_colors = await getBurstColors(reaction.emoji);

        await Message.update({ id: message.id, channel_id }, { reactions: message.reactions });

        const member = channel.guild_id
            ? (
                  await Member.findOneOrFail({
                      where: { id: req.user_id, guild_id: channel.guild_id },
                      relations: { roles: true, user: true },
                      select: {
                          index: true,
                          ...Object.fromEntries(PublicMemberProjection.map((x) => [x, true])),
                          user: Object.fromEntries(PublicUserProjection.map((x) => [x, true])),
                          roles: {
                              id: true,
                          },
                      },
                  })
              ).toPublicMember()
            : undefined;

        await emitEvent({
            event: "MESSAGE_REACTION_ADD",
            channel_id,
            data: {
                user_id: req.user_id,
                channel_id,
                message_id,
                guild_id: channel.guild_id,
                emoji: reaction.emoji,
                member,
                burst: type === ReactionType.burst,
                burst_colors: type === ReactionType.burst ? (reaction.burst_colors ?? []) : [],
                message_author_id: message.author_id,
                type,
            },
        } satisfies MessageReactionAddEvent);

        res.sendStatus(204);
    },
);

router.delete(
    "/:emoji/:user_id",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
            403: {},
        },
    }),
    (req: Request, res: Response) => removeReaction(req, res, getType(req.query.type, req.query.burst)),
);

router.delete(
    "/:emoji/:type/:user_id",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
            403: {},
        },
    }),
    (req: Request, res: Response) => removeReaction(req, res, getType(req.params.type)),
);

export default router;
