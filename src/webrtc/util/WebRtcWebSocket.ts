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
    sentMessages?: { seq: number; data: string | Buffer }[];
    sessionCleanups?: (() => Promise<unknown>)[];
    resumedBy?: WebRtcWebSocket;
    sessionEnded?: boolean;
    resumeTimer?: NodeJS.Timeout;
    lastActivity?: number;
    speaking?: number;
    moderation?: VoiceModeration;
}

export interface VoiceModeration {
    mute: boolean;
    deaf: boolean;
    video: boolean;
}
