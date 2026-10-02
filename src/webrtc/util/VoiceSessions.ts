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

import { StreamSession, VoiceState } from "@spacebar/database";
import { DaveSession } from "../dave/DaveSession";
import { VoiceOPCodes } from "./Constants";
import { mediaServer } from "./MediaServer";
import { Send, write } from "./Send";
import { WebRtcWebSocket } from "./WebRtcWebSocket";

const RESUME_WINDOW = 30_000;
const FIRST_VALIDITY_CHECK = 300;
const VALIDITY_CHECK_INTERVAL = 1000;
const FINAL_CLOSE_CODES = new Set([1000, 4004, 4006, 4011, 4014, 4015]);

const sessions = new Map<string, WebRtcWebSocket>();
const sessionKey = (serverId?: string, sessionId?: string) => `${serverId}:${sessionId}`;

const SESSION_FIELDS = [
    "user_id",
    "session_id",
    "type",
    "server_id",
    "token",
    "channel_id",
    "webRtcClient",
    "voiceRoomId",
    "maxDaveVersion",
    "daveVersion",
    "clientPlatform",
    "voiceSequence",
    "sentMessages",
    "sessionCleanups",
    "lastActivity",
    "speaking",
] as const satisfies readonly (keyof WebRtcWebSocket)[];

export const VoiceSessions = {
    find(serverId?: string, sessionId?: string) {
        return sessions.get(sessionKey(serverId, sessionId));
    },

    all() {
        return [...sessions.values()];
    },

    async register(socket: WebRtcWebSocket) {
        const key = sessionKey(socket.server_id, socket.session_id);
        const previous = sessions.get(key);
        sessions.set(key, socket);
        if (previous && previous !== socket) {
            await VoiceSessions.end(previous, previous.channel_id !== socket.channel_id);
            if (previous.readyState === 1) previous.close(4006, "Session replaced");
        }
    },

    async isValid(socket: WebRtcWebSocket) {
        if (socket.type === "stream")
            return StreamSession.exists({ where: { stream_id: socket.server_id, user_id: socket.user_id, token: socket.token, session_id: socket.session_id } });
        return VoiceState.exists({ where: { user_id: socket.user_id, session_id: socket.session_id, token: socket.token, channel_id: socket.channel_id } });
    },

    async end(socket: WebRtcWebSocket, notify = true) {
        if (socket.sessionEnded || socket.resumedBy) return;
        socket.sessionEnded = true;
        clearTimeout(socket.resumeTimer);
        const key = sessionKey(socket.server_id, socket.session_id);
        if (sessions.get(key) === socket) sessions.delete(key);

        const client = socket.webRtcClient;
        if (!socket.user_id || !client) return;
        mediaServer.onClientClose(client);
        await DaveSession.find(client.voiceRoomId)?.leave(socket.user_id, socket);
        if (notify)
            for (const other of mediaServer.getClientsForRtcServer<WebRtcWebSocket>(client.voiceRoomId))
                if (other.user_id !== socket.user_id) await Send(other.websocket, { op: VoiceOPCodes.CLIENT_DISCONNECT, d: { user_id: socket.user_id } });
        for (const cleanup of socket.sessionCleanups ?? []) await cleanup().catch((error) => console.error("[WebRTC] session cleanup failed", error));
    },

    async onSocketClosed(socket: WebRtcWebSocket, code: number) {
        if (socket.resumedBy || socket.sessionEnded) return;
        if (!socket.user_id || !socket.webRtcClient || FINAL_CLOSE_CODES.has(code)) return VoiceSessions.end(socket);

        const deadline = Date.now() + RESUME_WINDOW;
        const check = async () => {
            if (socket.resumedBy || socket.sessionEnded) return;
            if (Date.now() > deadline || !(await VoiceSessions.isValid(socket))) return VoiceSessions.end(socket);
            socket.resumeTimer = setTimeout(check, VALIDITY_CHECK_INTERVAL);
        };
        socket.resumeTimer = setTimeout(check, FIRST_VALIDITY_CHECK);
    },

    async resume(socket: WebRtcWebSocket, previous: WebRtcWebSocket, seqAck: number) {
        if (previous.sessionEnded || previous.resumedBy) return null;
        clearTimeout(previous.resumeTimer);
        for (const field of SESSION_FIELDS) (socket as unknown as Record<string, unknown>)[field] = previous[field];
        previous.resumedBy = socket;
        sessions.set(sessionKey(socket.server_id, socket.session_id), socket);
        if (socket.webRtcClient) {
            socket.webRtcClient.websocket = socket;
            DaveSession.find(socket.webRtcClient.voiceRoomId)?.rebind(socket.user_id, previous, socket);
        }
        if (previous.readyState === 1) previous.close(4000, "Session resumed elsewhere");

        await Send(socket, { op: VoiceOPCodes.RESUMED, d: null });
        if (socket.version < 8) return 0;
        const missed = (socket.sentMessages ?? []).filter((message) => {
            const ahead = (message.seq - seqAck) & 0xffff;
            return seqAck < 0 || (ahead > 0 && ahead < 0x8000);
        });
        for (const message of missed) await write(socket, message.data);
        return missed.length;
    },
};
