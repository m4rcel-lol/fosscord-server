/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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
import { Member, SoundboardSound } from "@spacebar/database";
import { FieldErrors, Snowflake, deleteFile, emitEvent, getPermission, handleFile } from "@spacebar/util";
import { SoundboardSoundCreateSchema, SoundboardSoundModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const MAX_SOUNDS = 48;
const MAX_SOUND_BYTES = 512 * 1024;

const canManage = async (req: Request, sound?: SoundboardSound) => {
    const permission = await getPermission(req.user_id, req.params.guild_id as string);
    if (permission.has("MANAGE_EMOJIS_AND_STICKERS")) return true;
    return permission.has("CREATE_GUILD_EXPRESSIONS") && (!sound || sound.user_id === req.user_id);
};

const findSound = async (guild_id: string, sound_id: string) => {
    const sound = await SoundboardSound.findOne({ where: { id: sound_id, guild_id }, relations: { user: true } });
    if (!sound) throw new HTTPError("Unknown Soundboard Sound", 404);
    return sound;
};

router.get(
    "/",
    route({
        responses: {
            200: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        await Member.IsInGuildOrFail(req.user_id, guild_id);
        const items = await SoundboardSound.find({ where: { guild_id }, relations: { user: true }, order: { id: "ASC" } });
        res.json({ items });
    },
);

router.get(
    "/:sound_id",
    route({
        responses: {
            200: {},
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sound_id } = req.params as { [key: string]: string };
        await Member.IsInGuildOrFail(req.user_id, guild_id);
        res.json(await findSound(guild_id, sound_id));
    },
);

router.post(
    "/",
    route({
        requestBody: "SoundboardSoundCreateSchema",
        responses: {
            201: {},
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as SoundboardSoundCreateSchema;
        if (!(await canManage(req))) throw new HTTPError("Missing Permissions", 403);

        if ((await SoundboardSound.count({ where: { guild_id } })) >= MAX_SOUNDS) throw new HTTPError(`Maximum number of soundboard sounds reached (${MAX_SOUNDS})`, 400);

        const mime = body.sound?.match(/^data:([^;,]+)[;,]/)?.[1];
        if (!mime?.startsWith("audio/")) throw FieldErrors({ sound: { code: "BINARY_TYPE_INVALID", message: "Sound must be an mp3 or ogg file" } });
        if (Buffer.byteLength(body.sound.split(",")[1] ?? "", "base64") > MAX_SOUND_BYTES)
            throw FieldErrors({ sound: { code: "BINARY_TYPE_MAX_SIZE", message: "File cannot be larger than 512 KB" } });

        const id = Snowflake.generate();
        await handleFile(`/soundboard-sounds/${id}`, body.sound);

        await SoundboardSound.create({
            id,
            guild_id,
            name: body.name,
            volume: body.volume ?? 1,
            emoji_id: body.emoji_id ?? null,
            emoji_name: body.emoji_id ? null : (body.emoji_name ?? null),
            user_id: req.user_id,
            available: true,
        }).save();

        const sound = await findSound(guild_id, id);
        await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_CREATE", guild_id, data: sound.toJSON() });

        res.status(201).json(sound);
    },
);

router.patch(
    "/:sound_id",
    route({
        requestBody: "SoundboardSoundModifySchema",
        responses: {
            200: {},
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sound_id } = req.params as { [key: string]: string };
        const body = req.body as SoundboardSoundModifySchema;
        const sound = await findSound(guild_id, sound_id);
        if (!(await canManage(req, sound))) throw new HTTPError("Missing Permissions", 403);

        if (body.name !== undefined) sound.name = body.name;
        if (body.volume !== undefined) sound.volume = body.volume ?? 1;
        if (body.emoji_id !== undefined || body.emoji_name !== undefined) {
            sound.emoji_id = body.emoji_id ?? null;
            sound.emoji_name = body.emoji_id ? null : (body.emoji_name ?? null);
        }
        await sound.save();

        await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_UPDATE", guild_id, data: sound.toJSON() });
        res.json(sound);
    },
);

router.delete(
    "/:sound_id",
    route({
        responses: {
            204: {},
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sound_id } = req.params as { [key: string]: string };
        const sound = await findSound(guild_id, sound_id);
        if (!(await canManage(req, sound))) throw new HTTPError("Missing Permissions", 403);

        await SoundboardSound.delete({ id: sound_id, guild_id });
        await deleteFile(`/soundboard-sounds/${sound_id}`).catch(() => undefined);

        await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_DELETE", guild_id, data: { guild_id, sound_id } });
        res.sendStatus(204);
    },
);

export default router;
