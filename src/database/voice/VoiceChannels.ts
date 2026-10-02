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

import { emitEvent } from "@spacebar/util/util";
import { Channel } from "../entities/Channel";
import { VoiceState } from "../entities/VoiceState";
import { PrivateCalls } from "./PrivateCalls";

export class VoiceChannels {
    static async startTime(channelId: string) {
        const row = await VoiceState.createQueryBuilder("voice_state")
            .select("MIN(voice_state.connected_at)", "start")
            .addSelect("COUNT(*)", "count")
            .where("voice_state.channel_id = :channelId", { channelId })
            .getRawOne<{ start: string | null; count: string }>();
        if (!row || Number(row.count) === 0) return null;
        return row.start != null ? Number(row.start) : Math.floor(Date.now() / 1000);
    }

    static async occupancyChanged(guildId: string | null | undefined, channelId: string | null | undefined, userId: string, joined: boolean) {
        if (!channelId) return;
        if (!guildId) return joined ? PrivateCalls.join(channelId, userId) : PrivateCalls.leave(channelId);

        const voiceStartTime = await VoiceChannels.startTime(channelId);
        await emitEvent({ event: "VOICE_CHANNEL_START_TIME_UPDATE", guild_id: guildId, data: { id: channelId, guild_id: guildId, voice_start_time: voiceStartTime } });
        if (voiceStartTime !== null) return;

        const channel = await Channel.findOne({ where: { id: channelId }, select: { id: true, status: true } });
        if (!channel?.status) return;
        await Channel.update({ id: channelId }, { status: null });
        await emitEvent({ event: "VOICE_CHANNEL_STATUS_UPDATE", guild_id: guildId, data: { id: channelId, guild_id: guildId, status: null } });
    }
}
