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

import { In } from "typeorm";
import { SoundboardSound } from "@spacebar/database";
import { MessageSoundboardSound } from "@spacebar/schemas";

export const DEFAULT_SOUNDBOARD_SOUNDS = [
    { name: "quack", sound_id: "1", emoji_name: "🦆" },
    { name: "airhorn", sound_id: "2", emoji_name: "🔊" },
    { name: "cricket", sound_id: "3", emoji_name: "🦗" },
    { name: "golf clap", sound_id: "4", emoji_name: "⛳" },
    { name: "sad horn", sound_id: "5", emoji_name: "🎺" },
    { name: "ba dum tss", sound_id: "7", emoji_name: "🥁" },
].map((sound) => ({ ...sound, volume: 1, emoji_id: null, user_id: "0", available: true }));

const plays = new Map<string, Map<string, number>>();

export function trackSoundboardPlay(guild_id: string, sound_id: string) {
    const guild = plays.get(guild_id) ?? new Map<string, number>();
    guild.set(sound_id, (guild.get(sound_id) ?? 0) + 1);
    plays.set(guild_id, guild);
}

export function topSoundboardSounds(guild_id: string) {
    return [...(plays.get(guild_id) ?? new Map<string, number>()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([sound_id], i) => ({ sound_id, sound_rank: i + 1 }));
}

export async function resolveSoundmoji(content?: string | null): Promise<MessageSoundboardSound[] | null> {
    const refs = [...new Map([...(content ?? "").matchAll(/<sound:(\d+):(\d+)>/g)].map(([, guild_id, sound_id]) => [sound_id, guild_id])).entries()].slice(0, 25);
    if (!refs.length) return null;
    const defaults = refs.filter(([, guild_id]) => guild_id === "0").map(([sound_id]) => DEFAULT_SOUNDBOARD_SOUNDS.find((sound) => sound.sound_id === sound_id));
    const custom = refs.filter(([, guild_id]) => guild_id !== "0");
    const found = custom.length ? await SoundboardSound.find({ where: { id: In(custom.map(([sound_id]) => sound_id)) } }) : [];
    const guildSounds = found.filter((sound) => sound.available && custom.some(([sound_id, guild_id]) => sound_id === sound.id && guild_id === sound.guild_id));
    const sounds = [
        ...defaults.filter((sound) => sound !== undefined).map((sound) => ({ ...sound, guild_id: "0", user_id: undefined })),
        ...guildSounds.map((sound) => ({ ...sound.toJSON(), user: undefined, emoji_name: sound.emoji_name ?? null, emoji_id: sound.emoji_id ?? null })),
    ];
    return sounds.length ? sounds : null;
}
