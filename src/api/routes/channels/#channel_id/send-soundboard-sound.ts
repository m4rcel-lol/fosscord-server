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
import { Member, SoundboardSound, VoiceState } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, getPermission } from "@spacebar/util";
import { HTTPError } from "lambert-server";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {}, 400: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as { [key: string]: string };
    const voiceState = await VoiceState.findOne({ where: { user_id: req.user_id, channel_id } });
    if (!voiceState) throw new HTTPError("You must be connected to this voice channel", 400);
    if (voiceState.mute || voiceState.deaf || voiceState.self_deaf || voiceState.suppress) throw new HTTPError("You cannot use the soundboard right now", 400);

    const sound = await SoundboardSound.findOne({ where: { id: String(req.body?.sound_id) } });
    if (!sound) throw new HTTPError("Unknown Soundboard Sound", 404);

    if (voiceState.guild_id) {
        const permissions = await getPermission(req.user_id, voiceState.guild_id, channel_id);
        permissions.hasThrow("SPEAK");
        permissions.hasThrow("USE_SOUNDBOARD");
        if (sound.guild_id !== voiceState.guild_id) {
            permissions.hasThrow("USE_EXTERNAL_SOUNDS");
            if (!(await Member.exists({ where: { id: req.user_id, guild_id: sound.guild_id } }))) throw DiscordApiErrors.MISSING_ACCESS;
        }
    } else if (!(await Member.exists({ where: { id: req.user_id, guild_id: sound.guild_id } }))) throw DiscordApiErrors.MISSING_ACCESS;

    await emitEvent({
        event: "VOICE_CHANNEL_EFFECT_SEND",
        guild_id: voiceState.guild_id ?? undefined,
        channel_id: voiceState.guild_id ? undefined : channel_id,
        data: {
            channel_id,
            guild_id: voiceState.guild_id ?? undefined,
            user_id: req.user_id,
            sound_id: sound.id,
            sound_volume: sound.volume,
            source_guild_id: sound.guild_id,
            emoji: sound.emoji_id || sound.emoji_name ? { id: sound.emoji_id ?? null, name: sound.emoji_name ?? null } : null,
        },
    });
    res.sendStatus(204);
});

export default router;
