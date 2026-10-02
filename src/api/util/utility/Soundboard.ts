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
