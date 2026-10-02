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
import { DEFAULT_SOUNDBOARD_SOUNDS, trackSoundboardPlay } from "@spacebar/api/util";
import { Channel, Member, SoundboardSound, VoiceState } from "@spacebar/database";
import { DiscordApiErrors, emitEvent } from "@spacebar/util";
import { SendSoundboardSoundSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "SendSoundboardSoundSchema",
        permission: ["SPEAK", "USE_SOUNDBOARD"],
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const body = req.body as SendSoundboardSoundSchema;
        const channel = await Channel.findOneOrFail({ where: { id: channel_id }, select: { id: true, guild_id: true } });

        const state = await VoiceState.findOne({ where: { user_id: req.user_id, channel_id } });
        if (!state) throw new HTTPError("You must be connected to this voice channel to play a sound", 400);
        if (state.deaf || state.self_deaf || state.mute || state.suppress) throw new HTTPError("You cannot play sounds while muted or deafened", 400);

        const standard = DEFAULT_SOUNDBOARD_SOUNDS.find((sound) => sound.sound_id === body.sound_id);
        const custom = standard ? null : await SoundboardSound.findOne({ where: { id: body.sound_id } });
        if (!standard && !custom) throw new HTTPError("Unknown Soundboard Sound", 404);
        if (custom && custom.guild_id !== channel.guild_id) {
            if (channel.guild_id) req.permission?.hasThrow("USE_EXTERNAL_SOUNDS");
            if (!(await Member.exists({ where: { id: req.user_id, guild_id: custom.guild_id } }))) throw DiscordApiErrors.MISSING_ACCESS;
        }

        const sound = custom
            ? { sound_id: custom.id, volume: custom.volume, emoji_id: custom.emoji_id, emoji_name: custom.emoji_name, guild_id: custom.guild_id }
            : { ...standard!, guild_id: undefined };
        if (channel.guild_id) trackSoundboardPlay(channel.guild_id, sound.sound_id);

        await emitEvent({
            event: "VOICE_CHANNEL_EFFECT_SEND",
            guild_id: channel.guild_id ?? undefined,
            channel_id: channel.guild_id ? undefined : channel_id,
            data: {
                channel_id,
                guild_id: channel.guild_id ?? undefined,
                user_id: req.user_id,
                sound_id: sound.sound_id,
                sound_volume: sound.volume,
                source_guild_id: sound.guild_id,
                emoji: sound.emoji_id || sound.emoji_name ? { id: sound.emoji_id, name: sound.emoji_name } : null,
                animation_type: null,
                animation_id: null,
            },
        });

        res.sendStatus(204);
    },
);

export default router;
