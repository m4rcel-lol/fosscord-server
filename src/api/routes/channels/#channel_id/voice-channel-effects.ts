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
import { Emoji, VoiceState } from "@spacebar/database";
import { emitEvent } from "@spacebar/util";
import { HTTPError } from "lambert-server";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {}, 400: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as { [key: string]: string };
    const voiceState = await VoiceState.findOne({ where: { user_id: req.user_id, channel_id } });
    if (!voiceState) throw new HTTPError("You must be connected to this voice channel", 400);
    const { emoji_id, emoji_name, animation_type, animation_id } = req.body ?? {};
    if (!emoji_id && !emoji_name) throw new HTTPError("emoji_id or emoji_name is required", 400);
    const emoji = emoji_id ? await Emoji.findOne({ where: { id: String(emoji_id) }, select: { id: true, name: true, animated: true } }) : null;

    await emitEvent({
        event: "VOICE_CHANNEL_EFFECT_SEND",
        guild_id: voiceState.guild_id ?? undefined,
        channel_id: voiceState.guild_id ? undefined : channel_id,
        data: {
            channel_id,
            guild_id: voiceState.guild_id ?? undefined,
            user_id: req.user_id,
            emoji: { id: emoji_id ?? null, name: emoji_name ?? emoji?.name ?? null, animated: emoji?.animated ?? false },
            animation_type: animation_type ?? 0,
            animation_id: animation_id ?? Math.floor(Math.random() * 20),
        },
    });
    res.sendStatus(204);
});

export default router;
