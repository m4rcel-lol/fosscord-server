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

import { VoicePayload, WebRtcWebSocket } from "../util";
import { VoiceSessions } from "../util/VoiceSessions";

export async function onResume(this: WebRtcWebSocket, data: VoicePayload) {
    clearTimeout(this.readyTimeout);
    if (this.user_id) return this.close(4005, "Already authenticated");

    const { server_id, session_id, token, seq_ack } = (data.d ?? {}) as { server_id?: string; session_id?: string; token?: string; seq_ack?: number };
    const previous = VoiceSessions.find(server_id, session_id);
    if (!previous || previous.token !== token || previous.sessionEnded || previous.resumedBy || !previous.webRtcClient) return this.close(4006, "Session no longer valid");
    if (!(await VoiceSessions.isValid(previous))) {
        await VoiceSessions.end(previous);
        return this.close(4006, "Session no longer valid");
    }

    const replayed = await VoiceSessions.resume(this, previous, typeof seq_ack === "number" ? seq_ack : -1);
    if (replayed === null) return this.close(4006, "Session no longer valid");
    console.log(`[WebRTC] ${this.user_id} resumed voice session ${session_id} on ${server_id} after seq ${seq_ack ?? "none"}, replayed ${replayed} messages`);
}
