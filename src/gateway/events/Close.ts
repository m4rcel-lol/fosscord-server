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

import { Member, Session, VoiceChannels, VoiceState } from "@spacebar/database";
import { isFinalClose, WebSocket } from "@spacebar/gateway/util";
import { broadcastPresence, emitEvent, emitSessionsReplace, VoiceStateUpdateEvent } from "@spacebar/util";
import { ProcessLifecycle } from "@spacebar/util/util/ProcessLifecycle";
import { openConnections } from "./Connection";

export async function Close(this: WebSocket, code: number, reason: Buffer) {
    console.log("[WebSocket] closed", code, reason.toString());
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    if (this.readyTimeout) clearTimeout(this.readyTimeout);
    this.deflate?.close();
    this.inflate?.close();
    this.removeAllListeners();

    if (this.session) {
        const authSessionId = this.session?.session_id;
        const closedAt = Date.now();

        if (!(ProcessLifecycle.state === "stopping" || ProcessLifecycle.state === "stopped"))
            setTimeout(
                async () => {
                    try {
                        if (authSessionId && this.user_id) {
                            const s = await Session.findOne({
                                where: { user_id: this.user_id, session_id: authSessionId },
                            });
                            if (s && (s.last_seen?.getTime() ?? 0) <= closedAt && !openConnections.some((x) => x.session_id === authSessionId && x.user_id === this.user_id)) {
                                await Session.update({ user_id: this.user_id, session_id: authSessionId }, { status: "offline", activities: [], client_status: {} });
                                await emitSessionsReplace(this.user_id);
                                await broadcastPresence(this.user_id);
                            }
                        }
                    } catch (e) {
                        console.error("[WebSocket] Close session cleanup failed", code, e);
                    }
                },
                isFinalClose(code) ? 0 : 10_000,
            );

        if (!this.user_id) console.error("No user id in websocket???", this);
        const voiceState = await VoiceState.findOne({
            where: { user_id: this.user_id },
        });

        // clear the voice state for this session if user was in voice channel
        if (voiceState && voiceState.session_id === this.session_id && voiceState.channel_id) {
            const prevGuildId = voiceState.guild_id;
            const prevChannelId = voiceState.channel_id;

            // @ts-expect-error channel_id is nullable
            voiceState.channel_id = null;
            // @ts-expect-error guild_id is nullable
            voiceState.guild_id = null;
            voiceState.self_stream = false;
            voiceState.self_video = false;
            voiceState.connected_at = null;
            await voiceState.save();

            const member = prevGuildId ? await Member.findOne({ where: { id: voiceState.user_id, guild_id: prevGuildId }, relations: { user: true, roles: true } }) : null;
            await emitEvent({
                event: "VOICE_STATE_UPDATE",
                data: {
                    ...voiceState.toPublicVoiceState(),
                    guild_id: prevGuildId ?? null,
                    member: member?.toPublicMember(),
                },
                guild_id: prevGuildId ?? undefined,
                channel_id: prevGuildId ? undefined : prevChannelId,
            } satisfies VoiceStateUpdateEvent);
            await VoiceChannels.occupancyChanged(prevGuildId, prevChannelId, this.user_id, false);
        }
    }
}
