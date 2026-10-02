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

import { Guild, VoiceChannels } from "@spacebar/database";
import { In } from "typeorm";
import { VoiceSessions } from "./VoiceSessions";

const CHECK_INTERVAL = 15_000;

export class AfkMover {
    private static timer?: NodeJS.Timeout;

    static start() {
        AfkMover.timer ??= setInterval(() => AfkMover.check().catch((error) => console.error("[WebRTC] AFK check failed", error)), CHECK_INTERVAL);
    }

    static stop() {
        clearInterval(AfkMover.timer);
        AfkMover.timer = undefined;
    }

    static async check() {
        const now = Date.now();
        const candidates = VoiceSessions.all().filter(
            (socket) => socket.type === "guild-voice" && !socket.sessionEnded && !socket.resumedBy && !socket.speaking && !socket.webRtcClient?.isProducingVideo(),
        );
        if (!candidates.length) return;

        const guildIds = [...new Set(candidates.map((socket) => socket.server_id!))];
        const guilds = await Guild.find({ where: { id: In(guildIds) }, select: { id: true, afk_channel_id: true, afk_timeout: true } });
        const settings = new Map(guilds.map((guild) => [guild.id, guild]));

        for (const socket of candidates) {
            const guild = settings.get(socket.server_id!);
            if (!guild?.afk_channel_id || !guild.afk_timeout || socket.channel_id === guild.afk_channel_id) continue;
            if (now - (socket.lastActivity ?? now) < guild.afk_timeout * 1000) continue;
            socket.lastActivity = now;
            console.log(`[WebRTC] moving ${socket.user_id} to the AFK channel of ${guild.id} after ${guild.afk_timeout}s without speaking`);
            await VoiceChannels.move(guild.id, socket.user_id, guild.afk_channel_id);
        }
    }
}
