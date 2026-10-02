import { WebSocket } from "@spacebar/gateway";
import type { WebRtcClient } from "@spacebarchat/spacebar-webrtc-types";

export interface WebRtcWebSocket extends WebSocket {
    type: "guild-voice" | "dm-voice" | "stream";
    webRtcClient?: WebRtcClient<WebRtcWebSocket>;
    voiceRoomId?: string;
    channel_id?: string;
    server_id?: string;
    token?: string;
    voiceSequence: number;
    maxDaveVersion: number;
    daveVersion: number;
    clientPlatform?: number;
}
