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
import { SelectProtocolSchema, validateSchema } from "@spacebar/schemas";
import { mediaServer, Send, VoiceOPCodes, VoicePayload, WebRtcWebSocket } from "@spacebar/webrtc";
import type { Codec } from "@spacebarchat/spacebar-webrtc-types";
import { DAVE_PROTOCOL_VERSION, DaveSession } from "../dave/DaveSession";

export async function onSelectProtocol(this: WebRtcWebSocket, payload: VoicePayload) {
    if (!this.webRtcClient) return;

    const data = validateSchema("SelectProtocolSchema", payload.d) as SelectProtocolSchema;

    if (data.protocol !== "webrtc") return this.close(4000, "only webrtc protocol supported currently");

    const response = await mediaServer.onOffer(this.webRtcClient, data.sdp ?? (typeof data.data === "string" ? data.data : ""), (data.codecs ?? []).filter((codec): codec is Codec => ["opus", "VP8", "VP9", "H264"].includes(codec.name)));
    this.daveVersion = Math.min(this.maxDaveVersion, DAVE_PROTOCOL_VERSION);

    await Send(this, {
        op: VoiceOPCodes.SESSION_DESCRIPTION,
        d: {
            video_codec: response.selectedVideoCodec,
            sdp: response.sdp,
            media_session_id: this.session_id,
            audio_codec: "opus",
            dave_protocol_version: this.daveVersion,
        },
    });

    const { voiceRoomId } = this.webRtcClient;
    const others = [...mediaServer.getClientsForRtcServer<WebRtcWebSocket>(voiceRoomId)].filter((client) => client.user_id !== this.user_id);

    if (others.length) await Send(this, { op: VoiceOPCodes.CLIENTS_CONNECT, d: { user_ids: others.map((client) => client.user_id) } });

    for (const client of others) {
        await Send(client.websocket, { op: VoiceOPCodes.CLIENTS_CONNECT, d: { user_ids: [this.user_id] } });
        await Send(client.websocket, { op: VoiceOPCodes.CLIENT_FLAGS, d: { user_id: this.user_id, flags: 0 } });
        await Send(client.websocket, { op: VoiceOPCodes.CLIENT_PLATFORM, d: { user_id: this.user_id, platform: this.clientPlatform ?? 0 } });
        await Send(this, { op: VoiceOPCodes.CLIENT_FLAGS, d: { user_id: client.user_id, flags: 0 } });
        await Send(this, { op: VoiceOPCodes.CLIENT_PLATFORM, d: { user_id: client.user_id, platform: client.websocket.clientPlatform ?? 0 } });
    }

    if (this.daveVersion > 0) await DaveSession.get(voiceRoomId, this.channel_id ?? voiceRoomId).join(this);
}
