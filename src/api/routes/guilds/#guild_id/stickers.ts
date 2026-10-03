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
import multer from "multer";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Member, Sticker } from "@spacebar/database";
import { GuildStickersUpdateEvent, Snowflake, emitEvent, uploadFile, deleteFile, Config, DiscordApiErrors } from "@spacebar/util";
import { AuditLogEvents, ModifyGuildStickerSchema, StickerFormatType, StickerType } from "@spacebar/schemas";

const stickerAuditKeys = ["name", "description", "tags", "format_type", "available"];

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "StickersResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        await Member.IsInGuildOrFail(req.user_id, guild_id);

        res.json(await Sticker.find({ where: { guild_id }, relations: { user: true } }));
    },
);

const bodyParser = multer({
    limits: {
        fileSize: 1024 * 1024 * 100,
        fields: 10,
        files: 1,
    },
    storage: multer.memoryStorage(),
}).single("file");

router.post(
    "/",
    bodyParser,
    route({
        permission: "MANAGE_EMOJIS_AND_STICKERS",
        requestBody: "ModifyGuildStickerSchema",
        responses: {
            200: {
                body: "Sticker",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        if (!req.file) throw new HTTPError("missing file");

        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as ModifyGuildStickerSchema;
        const id = Snowflake.generate();

        const sticker_count = await Sticker.count({
            where: { guild_id: guild_id },
        });
        const { maxStickers } = Config.get().limits.guild;

        if (sticker_count >= maxStickers) throw DiscordApiErrors.MAXIMUM_STICKERS.withParams(maxStickers);

        const { content_type } = await uploadFile(`/stickers/${id}`, req.file);

        const sticker = await Sticker.create({
            name: body.name,
            description: body.description,
            tags: body.tags,
            guild_id,
            id,
            type: StickerType.GUILD,
            format_type: getStickerFormat(content_type ?? req.file.mimetype),
            available: true,
            user_id: req.user_id,
        }).save();
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.STICKER_CREATE,
            target_id: id,
            changes: AuditLog.diff({}, sticker, stickerAuditKeys),
            reason: req.headers["x-audit-log-reason"],
        });

        await sendStickerUpdateEvent(guild_id);

        res.json(await Sticker.findOneOrFail({ where: { id }, relations: { user: true } }));
    },
);

function getStickerFormat(mime_type: string) {
    switch (mime_type) {
        case "image/apng":
            return StickerFormatType.APNG;
        case "application/json":
            return StickerFormatType.LOTTIE;
        case "image/png":
        case "image/webp":
            return StickerFormatType.PNG;
        case "image/gif":
            return StickerFormatType.GIF;
        default:
            throw new HTTPError("invalid sticker format: must be png, apng, gif or lottie");
    }
}

router.get(
    "/:sticker_id",
    route({
        responses: {
            200: {
                body: "Sticker",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sticker_id } = req.params as { [key: string]: string };
        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const sticker = await Sticker.findOne({ where: { guild_id, id: sticker_id }, relations: { user: true } });
        if (!sticker) throw DiscordApiErrors.UNKNOWN_STICKER;
        res.json(sticker);
    },
);

router.patch(
    "/:sticker_id",
    route({
        requestBody: "ModifyGuildStickerSchema",
        permission: "MANAGE_EMOJIS_AND_STICKERS",
        responses: {
            200: {
                body: "Sticker",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sticker_id } = req.params as { [key: string]: string };
        const body = req.body as ModifyGuildStickerSchema;

        const sticker = await Sticker.findOne({ where: { guild_id, id: sticker_id }, relations: { user: true } });
        if (!sticker) throw DiscordApiErrors.UNKNOWN_STICKER;

        const auditBefore = { name: sticker.name, description: sticker.description, tags: sticker.tags };
        if (body.name !== undefined) sticker.name = body.name;
        if (body.description !== undefined) sticker.description = body.description;
        if (body.tags !== undefined) sticker.tags = body.tags;
        await sticker.save();
        const changes = AuditLog.diff(auditBefore, sticker, ["name", "description", "tags"]);
        if (changes.length)
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.STICKER_UPDATE,
                target_id: sticker_id,
                changes,
                reason: req.headers["x-audit-log-reason"],
            });
        await sendStickerUpdateEvent(guild_id);

        return res.json(sticker);
    },
);

async function sendStickerUpdateEvent(guild_id: string) {
    return emitEvent({
        event: "GUILD_STICKERS_UPDATE",
        guild_id: guild_id,
        data: {
            guild_id: guild_id,
            stickers: await Sticker.find({ where: { guild_id: guild_id } }),
        },
    } satisfies GuildStickersUpdateEvent);
}

router.delete(
    "/:sticker_id",
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
        const { guild_id, sticker_id } = req.params as { [key: string]: string };

        const sticker = await Sticker.findOne({ where: { guild_id, id: sticker_id } });
        if (!sticker) throw DiscordApiErrors.UNKNOWN_STICKER;

        await Sticker.delete({ guild_id, id: sticker_id });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.STICKER_DELETE,
            target_id: sticker_id,
            changes: AuditLog.diff(sticker, {}, stickerAuditKeys),
            reason: req.headers["x-audit-log-reason"],
        });
        await deleteFile(`/stickers/${sticker_id}`).catch(() => undefined);
        await sendStickerUpdateEvent(guild_id);

        return res.sendStatus(204);
    },
);

export default router;
