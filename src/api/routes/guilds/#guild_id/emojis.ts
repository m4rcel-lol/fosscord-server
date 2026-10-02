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
import { Emoji, Member } from "@spacebar/database";
import { Config, DiscordApiErrors, FieldErrors, GuildEmojisUpdateEvent, Snowflake, deleteFile, emitEvent, handleFile } from "@spacebar/util";
import { EmojiCreateSchema, EmojiModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const normalizeName = (name?: string) => {
    if (name === undefined) return undefined;
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, "");
    if (cleaned.length < 2 || cleaned.length > 32)
        throw FieldErrors({ name: { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 2 and 32 in length and contain only letters, numbers and underscores." } });
    return cleaned;
};

const emitEmojisUpdate = async (guild_id: string) =>
    emitEvent({
        event: "GUILD_EMOJIS_UPDATE",
        guild_id,
        data: {
            guild_id,
            emojis: await Emoji.find({ where: { guild_id } }),
        },
    } satisfies GuildEmojisUpdateEvent);

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "EmojisResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const emojis = await Emoji.find({
            where: { guild_id: guild_id },
            relations: { user: true },
        });

        return res.json(emojis);
    },
);

router.get(
    "/:emoji_id",
    route({
        responses: {
            200: {
                body: "Emoji",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, emoji_id } = req.params as { [key: string]: string };

        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const emoji = await Emoji.findOne({
            where: { guild_id: guild_id, id: emoji_id },
            relations: { user: true },
        });
        if (!emoji) throw DiscordApiErrors.UNKNOWN_EMOJI;

        return res.json(emoji);
    },
);

router.post(
    "/",
    route({
        requestBody: "EmojiCreateSchema",
        permission: "MANAGE_EMOJIS_AND_STICKERS",
        responses: {
            201: {
                body: "Emoji",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as EmojiCreateSchema;

        const id = Snowflake.generate();
        const emoji_count = await Emoji.count({
            where: { guild_id: guild_id },
        });
        const { maxEmojis } = Config.get().limits.guild;

        if (emoji_count >= maxEmojis) throw DiscordApiErrors.MAXIMUM_NUMBER_OF_EMOJIS_REACHED.withParams(maxEmojis);
        const name = normalizeName(body.name ?? "emoji")!;
        if (!body.image?.startsWith("data:")) throw FieldErrors({ image: { code: "BINARY_TYPE_MAX_SIZE", message: "Invalid image data" } });

        const hash = await handleFile(`/emojis/${id}`, body.image);
        if (!hash) throw new HTTPError("Invalid image data", 400);

        await Emoji.create({
            id: id,
            guild_id: guild_id,
            name,
            require_colons: body.require_colons ?? true,
            user: req.user,
            managed: false,
            animated: hash.startsWith("a_"),
            available: true,
            roles: body.roles ?? [],
        }).save();

        await emitEmojisUpdate(guild_id);

        return res.status(201).json(await Emoji.findOneOrFail({ where: { id }, relations: { user: true } }));
    },
);

router.patch(
    "/:emoji_id",
    route({
        requestBody: "EmojiModifySchema",
        permission: "MANAGE_EMOJIS_AND_STICKERS",
        responses: {
            200: {
                body: "Emoji",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { emoji_id, guild_id } = req.params as { [key: string]: string };
        const body = req.body as EmojiModifySchema;

        const emoji = await Emoji.findOne({
            where: { guild_id: guild_id, id: emoji_id },
            relations: { user: true },
        });
        if (!emoji) throw DiscordApiErrors.UNKNOWN_EMOJI;

        if (body.name !== undefined) emoji.name = normalizeName(body.name)!;
        if (body.roles !== undefined) emoji.roles = body.roles ?? [];
        await emoji.save();

        await emitEmojisUpdate(guild_id);

        return res.json(emoji);
    },
);

router.delete(
    "/:emoji_id",
    route({
        permission: "MANAGE_EMOJIS_AND_STICKERS",
        responses: {
            204: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { emoji_id, guild_id } = req.params as { [key: string]: string };

        const emoji = await Emoji.findOne({ where: { id: emoji_id, guild_id } });
        if (!emoji) throw DiscordApiErrors.UNKNOWN_EMOJI;

        await Emoji.delete({ id: emoji_id, guild_id });
        await deleteFile(`/emojis/${emoji_id}`).catch(() => undefined);

        await emitEmojisUpdate(guild_id);

        res.sendStatus(204);
    },
);

export default router;
