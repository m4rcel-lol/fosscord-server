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
import { deleteFile, DiscordApiErrors, emitEvent, getPermission } from "@spacebar/util";
import { HTTPError } from "lambert-server";
import { validateSoundFields } from "./index";

const router: Router = Router({ mergeParams: true });

const findSound = async (req: Request) => {
    const { guild_id, sound_id } = req.params as { [key: string]: string };
    const sound = await SoundboardSound.findOne({ where: { id: sound_id, guild_id }, relations: { user: true } });
    if (!sound) throw new HTTPError("Unknown Soundboard Sound", 404);
    return sound;
};

const assertCanManage = async (req: Request, sound: SoundboardSound) => {
    const permissions = await getPermission(req.user_id, sound.guild_id);
    if (permissions.has("MANAGE_EMOJIS_AND_STICKERS")) return;
    if (sound.user_id === req.user_id && permissions.has("CREATE_GUILD_EXPRESSIONS")) return;
    throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("MANAGE_GUILD_EXPRESSIONS");
};

router.get("/", route({ responses: { 200: {}, 404: {} } }), async (req: Request, res: Response) => {
    if (!(await Member.exists({ where: { id: req.user_id, guild_id: req.params.guild_id as string } }))) throw DiscordApiErrors.UNKNOWN_GUILD;
    res.json((await findSound(req)).toJSON());
});

router.patch("/", route({ responses: { 200: {}, 400: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const sound = await findSound(req);
    await assertCanManage(req, sound);
    Object.assign(sound, validateSoundFields(req.body ?? {}));
    await sound.save();
    await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_UPDATE", guild_id: sound.guild_id, data: sound.toJSON() });
    res.json(sound.toJSON());
});

router.delete("/", route({ responses: { 204: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const sound = await findSound(req);
    await assertCanManage(req, sound);
    await sound.remove();
    await deleteFile(`/soundboard-sounds/${req.params.sound_id as string}`).catch(() => {});
    await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_DELETE", guild_id: req.params.guild_id as string, data: { sound_id: req.params.sound_id, guild_id: req.params.guild_id } });
    res.sendStatus(204);
});

export default router;
