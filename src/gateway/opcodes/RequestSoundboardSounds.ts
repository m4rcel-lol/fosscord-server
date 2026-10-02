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
import { WebSocket, Payload, OPCODES, Send } from "@spacebar/gateway";
import { Member, SoundboardSound } from "@spacebar/database";

export async function onRequestSoundboardSounds(this: WebSocket, { d }: Payload) {
    const requested = Array.isArray(d?.guild_ids) ? (d.guild_ids as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 200) : [];
    if (!requested.length) return;

    const members = await Member.find({ where: { id: this.user_id, guild_id: In(requested) }, select: { guild_id: true } });
    const guild_ids = members.map((m) => m.guild_id);
    const sounds = guild_ids.length ? await SoundboardSound.find({ where: { guild_id: In(guild_ids) }, relations: { user: true }, order: { id: "ASC" } }) : [];

    for (const guild_id of guild_ids) {
        await Send(this, {
            op: OPCODES.Dispatch,
            t: "SOUNDBOARD_SOUNDS",
            s: this.sequence++,
            d: {
                guild_id,
                soundboard_sounds: sounds.filter((sound) => sound.guild_id === guild_id).map((sound) => sound.toJSON()),
            },
        });
    }
}
