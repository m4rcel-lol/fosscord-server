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
import { Member, SoundboardSound } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, getPermission, handleFile, Snowflake } from "@spacebar/util";
import { HTTPError } from "lambert-server";

const router: Router = Router({ mergeParams: true });
const MAX_SOUND_BYTES = 512 * 1024;

export const validateSoundFields = (body: Record<string, unknown>) => {
    const changes: Partial<Pick<SoundboardSound, "name" | "volume" | "emoji_id" | "emoji_name">> = {};
    if ("name" in body) {
        if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 32) throw new HTTPError("name must be between 2 and 32 characters", 400);
        changes.name = body.name.trim();
    }
    if (body.volume != null) {
        const volume = Number(body.volume);
        if (Number.isNaN(volume) || volume < 0 || volume > 1) throw new HTTPError("volume must be between 0 and 1", 400);
        changes.volume = volume;
    }
    if ("emoji_id" in body) changes.emoji_id = (body.emoji_id as string) ?? undefined;
    if ("emoji_name" in body) changes.emoji_name = (body.emoji_name as string) ?? undefined;
    return changes;
};

router.get("/", route({ responses: { 200: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    if (!(await Member.exists({ where: { id: req.user_id, guild_id } }))) throw DiscordApiErrors.UNKNOWN_GUILD;
    const sounds = await SoundboardSound.find({ where: { guild_id }, relations: { user: true } });
    res.json({ items: sounds.map((sound) => sound.toJSON()) });
});

router.post("/", route({ responses: { 201: {}, 400: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const permissions = await getPermission(req.user_id, guild_id);
    if (!permissions.has("CREATE_GUILD_EXPRESSIONS") && !permissions.has("MANAGE_EMOJIS_AND_STICKERS"))
        throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("CREATE_GUILD_EXPRESSIONS");

    const fields = validateSoundFields(req.body ?? {});
    if (!fields.name) throw new HTTPError("name is required", 400);
    const data = req.body?.sound;
    if (typeof data !== "string" || !/^data:audio\/[\w.+-]+;base64,/.test(data)) throw new HTTPError("sound must be an audio data URI", 400);
    if (Buffer.byteLength(data.split(",")[1], "base64") > MAX_SOUND_BYTES) throw new HTTPError("sound must be at most 512 KB", 400);

    const id = Snowflake.generate();
    await handleFile(`/soundboard-sounds/${id}`, data);
    const sound = SoundboardSound.create({ id, guild_id, user_id: req.user_id, available: true, volume: 1, ...fields });
    await sound.save();
    const saved = await SoundboardSound.findOneOrFail({ where: { id }, relations: { user: true } });
    await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_CREATE", guild_id, data: saved.toJSON() });
    res.status(201).json(saved.toJSON());
});

export default router;
