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

import { Payload } from "./Constants";
import { WebSocket } from "./WebSocket";

export const RESUME_WINDOW_MS = 90_000;
export const REPLAY_BUFFER_SIZE = 250;
export const MAX_RESUME_BUFFER = 5000;

export const resumableSockets = new Map<string, WebSocket>();

export function resolveSocket(socket: WebSocket) {
    let current = socket;
    while (current.resumedBy) current = current.resumedBy;
    return current;
}

export function rememberDispatch(socket: WebSocket, payload: Payload) {
    if (payload.op !== 0 || payload.s === undefined) return;
    socket.replayBuffer ??= [];
    socket.replayBuffer.push(payload);
    if (socket.replayBuffer.length > REPLAY_BUFFER_SIZE) socket.replayBuffer.shift();
}

export function holdForResume(socket: WebSocket, cleanup: () => Promise<void>) {
    const release = () => cleanup().catch((e) => console.error(`[Gateway/${socket.user_id}] listener cleanup failed`, e));
    if (!socket.user_id || !socket.session_id || socket.session_id.startsWith("TEMP_")) return release();

    socket.resumeBuffer = [];
    resumableSockets.set(socket.session_id, socket);
    socket.resumeTimer = setTimeout(() => {
        if (resumableSockets.get(socket.session_id) === socket) resumableSockets.delete(socket.session_id);
        socket.resumeBuffer = undefined;
        socket.replayBuffer = undefined;
        if (!socket.resumedBy) release();
    }, RESUME_WINDOW_MS);
}

export function bufferForResume(socket: WebSocket, payload: Payload) {
    if (!socket.resumeBuffer) return false;
    if (socket.resumeBuffer.length >= MAX_RESUME_BUFFER) {
        socket.resumeBuffer = undefined;
        resumableSockets.delete(socket.session_id);
        return true;
    }
    socket.resumeBuffer.push(payload);
    return true;
}
