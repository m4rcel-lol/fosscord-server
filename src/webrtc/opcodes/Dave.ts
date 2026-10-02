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
import { DaveSession } from "../dave/DaveSession";

const session = (socket: WebRtcWebSocket) => (socket.daveVersion > 0 ? DaveSession.find(socket.webRtcClient?.voiceRoomId) : undefined);

export async function onDaveReadyForTransition(this: WebRtcWebSocket, data: VoicePayload) {
    await session(this)?.onReadyForTransition(this.user_id, Number(data.d?.transition_id));
}

export async function onDaveInvalidCommitWelcome(this: WebRtcWebSocket, data: VoicePayload) {
    await session(this)?.onInvalidCommitWelcome(this.user_id, Number(data.d?.transition_id));
}

export async function onMlsKeyPackage(this: WebRtcWebSocket, data: VoicePayload) {
    if (!Buffer.isBuffer(data.d)) return;
    await session(this)?.onKeyPackage(this, data.d);
}

export async function onMlsCommitWelcome(this: WebRtcWebSocket, data: VoicePayload) {
    if (!Buffer.isBuffer(data.d)) return;
    await session(this)?.onCommitWelcome(this, data.d);
}
