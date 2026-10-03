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

import { ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import EventEmitter from "node:events";
import type { ClientEmitter, Codec, SignalingDelegate, SSRCs, VideoStream, WebRtcClient } from "@spacebarchat/spacebar-webrtc-types";
import { IpcClient, IpcPayload } from "./IpcClient";
import type { VoiceModeration } from "../util/WebRtcWebSocket";

type RoomType = "guild-voice" | "dm-voice" | "stream";

const AUDIO_EXTENSIONS = ["urn:ietf:params:rtp-hdrext:ssrc-audio-level", "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01"];
const VIDEO_EXTENSIONS = [
    "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
    "urn:ietf:params:rtp-hdrext:toffset",
    "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
    "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
    "urn:3gpp:video-orientation",
];

class PionClient implements WebRtcClient<unknown> {
    readonly uniqueId = randomUUID();
    readonly emitter: ClientEmitter = new EventEmitter();
    webrtcConnected = false;
    videoStream?: VideoStream;
    stopped = false;
    private incoming: SSRCs = {};
    private published = { audio: false, video: false };
    readonly outgoing = new Map<string, SSRCs>();

    constructor(
        readonly user_id: string,
        readonly voiceRoomId: string,
        public websocket: unknown,
        readonly server: PionMediaServer,
    ) {}

    initIncomingSSRCs(ssrcs: SSRCs) {
        this.incoming = { ...ssrcs };
    }

    getIncomingStreamSSRCs() {
        return this.incoming;
    }

    getOutgoingStreamSSRCsForUser(userId: string) {
        return this.outgoing.get(userId) ?? {};
    }

    isProducingAudio() {
        return this.published.audio;
    }

    isProducingVideo() {
        return this.published.video;
    }

    async publishTrack(type: "audio" | "video", ssrcs: SSRCs) {
        if (type === "audio") this.incoming.audio_ssrc = ssrcs.audio_ssrc;
        else this.incoming = { ...ssrcs, audio_ssrc: this.incoming.audio_ssrc };
        this.published[type] = true;
        this.server.ipc.send({ type: "publish", clientId: this.uniqueId, trackType: type });
    }

    stopPublishingTrack(type: "audio" | "video") {
        if (type === "audio") this.incoming.audio_ssrc = undefined;
        else this.incoming = { audio_ssrc: this.incoming.audio_ssrc };
        this.published[type] = false;
        this.server.ipc.send({ type: "stop-publish", clientId: this.uniqueId, trackType: type });
    }

    moderate({ mute, deaf, video }: VoiceModeration) {
        this.server.ipc.send({ type: "moderate", clientId: this.uniqueId, blockAudio: mute, blockVideo: video, deaf });
    }

    requestKeyframe() {
        if (this.published.video) this.server.ipc.send({ type: "keyframe", clientId: this.uniqueId });
    }

    async subscribeToTrack(userId: string, type: "audio" | "video") {
        const publisher = this.server.findClient(this.voiceRoomId, userId);
        if (!publisher) return;
        const result = await this.server.ipc.request({ type: "subscribe", clientId: this.uniqueId, publisherId: publisher.uniqueId, trackType: type }).catch((error) => {
            console.log(`[WebRTC] ${this.user_id} could not subscribe to ${type} of ${userId}: ${error.message}`);
            return undefined;
        });
        if (!result) return;
        const declared = publisher.getIncomingStreamSSRCs();
        const ssrc = result.ssrc || (type === "audio" ? declared.audio_ssrc : declared.video_ssrc);
        if (!ssrc) return;
        const ssrcs = this.outgoing.get(userId) ?? {};
        if (type === "audio") ssrcs.audio_ssrc = ssrc;
        else {
            ssrcs.video_ssrc = ssrc;
            ssrcs.rtx_ssrc = (ssrc + 1) >>> 0;
            for (const delay of [250, 1000]) setTimeout(() => publisher.requestKeyframe(), delay);
        }
        this.outgoing.set(userId, ssrcs);
    }

    unSubscribeFromTrack(userId: string, type: "audio" | "video") {
        const ssrcs = this.outgoing.get(userId);
        if (ssrcs) {
            if (type === "audio") ssrcs.audio_ssrc = undefined;
            else ssrcs.video_ssrc = ssrcs.rtx_ssrc = undefined;
        }
        const publisher = this.server.findClient(this.voiceRoomId, userId);
        if (publisher) this.server.ipc.send({ type: "unsubscribe", clientId: this.uniqueId, trackType: type, publisherId: publisher.uniqueId });
    }

    isSubscribedToTrack(userId: string, type: "audio" | "video") {
        const ssrcs = this.outgoing.get(userId) ?? {};
        return (type === "audio" ? ssrcs.audio_ssrc : ssrcs.video_ssrc) !== undefined;
    }
}

export class PionMediaServer implements SignalingDelegate {
    private rooms = new Map<string, { type: RoomType; clients: Map<string, PionClient> }>();
    private process?: ChildProcess;
    private stopping = false;
    private _ip = "127.0.0.1";
    private _port = 0;
    private restarts = 0;
    private lastExit: { code: number | null; at: Date } | null = null;
    ipc!: IpcClient;

    get ip() {
        return this._ip;
    }

    get port() {
        return this._port;
    }

    async start(publicIp: string, portMin: number) {
        this._ip = publicIp;
        this._port = portMin;
        const socketPath = process.env.PION_SFU_IPC || `/tmp/spacebar-sfu-${portMin}.sock`;
        this.ipc = new IpcClient(
            socketPath,
            (payload) => this.onEvent(payload),
            () => this.onIpcClose(),
        );
        if (process.env.PION_SFU_BIN) this.spawn(socketPath);
        await this.ipc.connect();
        console.log(`[WebRTC] connected to pion SFU at ${socketPath}, media on udp ${publicIp}:${portMin}`);
    }

    private spawn(socketPath: string) {
        const extraArgs = process.env.PION_SFU_ARGS?.split(/\s+/).filter(Boolean) ?? [];
        const child = spawn(
            process.env.PION_SFU_BIN!,
            ["-port", String(this._port), "-ip", this._ip, "-ipc", socketPath, ...(process.env.PION_SFU_VERBOSE ? ["-verbose"] : []), ...extraArgs],
            {
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        const log = (data: Buffer) => {
            if (process.env.PION_SFU_VERBOSE || process.env.PION_SFU_LOG) for (const line of data.toString().trimEnd().split("\n")) console.log(`[Pion SFU] ${line}`);
        };
        child.stdout?.on("data", log);
        child.stderr?.on("data", log);
        child.once("exit", (code) => {
            console.log(`[WebRTC] pion SFU exited with code ${code}`);
            this.lastExit = { code, at: new Date() };
            this.ipc.close();
            this.dropClients();
            if (this.stopping) return;
            setTimeout(() => {
                this.restarts++;
                this.spawn(socketPath);
                this.ipc.connect().catch((error) => console.error("[WebRTC] could not reconnect to pion SFU", error));
            }, 1000);
        });
        this.process = child;
        process.once("exit", () => child.kill());
    }

    private dropClients() {
        for (const room of this.rooms.values()) for (const client of room.clients.values()) (client.websocket as { close?: (code: number) => void }).close?.(4015);
        this.rooms.clear();
    }

    private onIpcClose() {
        if (this.process || this.stopping) return;
        console.log(`[WebRTC] lost the pion SFU at ${this.ipc.socketPath}, reconnecting`);
        this.dropClients();
        const reconnect = (): Promise<void> =>
            this.ipc.connect(60000).then(
                () => console.log(`[WebRTC] reconnected to pion SFU at ${this.ipc.socketPath}`),
                () => (this.stopping ? undefined : reconnect()),
            );
        void reconnect();
    }

    private onEvent(payload: IpcPayload) {
        if (payload.type !== "connected") return;
        for (const room of this.rooms.values())
            for (const client of room.clients.values())
                if (client.uniqueId === payload.clientId) {
                    client.webrtcConnected = true;
                    client.emitter.emit("connected");
                }
    }

    async health() {
        const clients = [...this.rooms.values()].flatMap((room) => [...room.clients.values()]);
        const ping = this.ipc?.connected
            ? await this.ipc.ping().then(
                  (ms) => ({ ms, error: null }),
                  (e: Error) => ({ ms: null, error: e.message }),
              )
            : { ms: null, error: "not connected" };
        return {
            sfu: {
                connected: !!this.ipc?.connected,
                socket: this.ipc?.socketPath ?? "",
                managed: !!process.env.PION_SFU_BIN,
                pid: this.process?.exitCode === null ? (this.process.pid ?? null) : null,
                restarts: this.restarts,
                last_exit_code: this.lastExit?.code ?? null,
                last_exit_at: this.lastExit?.at.toISOString() ?? null,
                ping_ms: ping.ms === null ? null : Math.round(ping.ms * 10) / 10,
                ping_error: ping.error,
                public_ip: this._ip,
                udp_port: this._port,
            },
            rooms: this.rooms.size,
            clients: clients.length,
            connected_clients: clients.filter((c) => c.webrtcConnected).length,
        };
    }

    findClient(roomId: string, userId: string) {
        return this.rooms.get(roomId)?.clients.get(userId);
    }

    async join<T>(roomId: string, userId: string, ws: T, type: RoomType): Promise<WebRtcClient<T>> {
        if (type !== "stream")
            for (const room of this.rooms.values()) {
                const existing = room.type !== "stream" ? room.clients.get(userId) : undefined;
                if (existing) this.onClientClose(existing);
            }
        const existing = this.findClient(roomId, userId);
        if (existing) this.onClientClose(existing);

        let room = this.rooms.get(roomId);
        if (!room) this.rooms.set(roomId, (room = { type, clients: new Map() }));
        const client = new PionClient(userId, roomId, ws, this);
        room.clients.set(userId, client);
        await this.ipc.request({ type: "join", clientId: client.uniqueId });
        return client as WebRtcClient<T>;
    }

    async onOffer<T>(webRtcClient: WebRtcClient<T>, sdp: string, codecs: Codec[]) {
        const client = webRtcClient as unknown as PionClient;
        const lines = sdp.split(/\r?\n/).map((line) => line.trim());
        const attribute = (name: string) => lines.find((line) => line.startsWith(`a=${name}:`))?.slice(name.length + 3);
        const extensions = new Map(
            lines.flatMap((line) => {
                const match = /^a=extmap:(\d+)(?:\/\w+)? (\S+)/.exec(line);
                return match ? [[match[2], Number(match[1])] as const] : [];
            }),
        );
        const extmap = (uris: string[]) => uris.flatMap((uri) => (extensions.has(uri) ? [`a=extmap:${extensions.get(uri)} ${uri}`] : []));

        const opus = codecs.find((codec) => codec.name === "opus")?.payload_type ?? 111;
        const h264 = codecs.find((codec) => codec.name === "H264");
        const videoPayload = h264?.payload_type ?? 102;
        const rtxPayload = h264?.rtx_payload_type ?? 103;
        const transport = [
            `a=ice-ufrag:${attribute("ice-ufrag")}`,
            `a=ice-pwd:${attribute("ice-pwd")}`,
            `a=fingerprint:${attribute("fingerprint")}`,
            "a=setup:active",
            "a=rtcp-mux",
        ];

        const offer = [
            "v=0",
            "o=- 0 0 IN IP4 127.0.0.1",
            "s=-",
            "t=0 0",
            "a=group:BUNDLE 0 1",
            `m=audio 9 UDP/TLS/RTP/SAVPF ${opus}`,
            "c=IN IP4 0.0.0.0",
            ...transport,
            "a=mid:0",
            "a=sendrecv",
            ...extmap(AUDIO_EXTENSIONS),
            `a=rtpmap:${opus} opus/48000/2`,
            `a=rtcp-fb:${opus} transport-cc`,
            `a=rtcp-fb:${opus} nack`,
            `a=fmtp:${opus} minptime=10;usedtx=1;useinbandfec=1`,
            `m=video 9 UDP/TLS/RTP/SAVPF ${videoPayload} ${rtxPayload}`,
            "c=IN IP4 0.0.0.0",
            ...transport,
            "a=mid:1",
            "a=sendrecv",
            ...extmap(VIDEO_EXTENSIONS),
            `a=rtpmap:${videoPayload} H264/90000`,
            ...["ccm fir", "nack", "nack pli", "goog-remb", "transport-cc"].map((feedback) => `a=rtcp-fb:${videoPayload} ${feedback}`),
            `a=fmtp:${videoPayload} level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-max-bitrate=2500`,
            `a=rtpmap:${rtxPayload} rtx/90000`,
            `a=fmtp:${rtxPayload} apt=${videoPayload}`,
            "",
        ].join("\r\n");

        const answer = await this.ipc.request({ type: "offer", clientId: client.uniqueId, sdp: offer });
        const answerLines = (answer.sdp ?? "").split(/\r?\n/);
        const answerAttribute = (name: string) => answerLines.find((line) => line.startsWith(`a=${name}:`))?.slice(name.length + 3);
        const candidate = answerAttribute("candidate")?.split(" ");
        const fingerprint = answerAttribute("fingerprint");
        if (!candidate || !fingerprint) throw new Error("SFU answer has no candidate or fingerprint");
        const [, , protocol, priority, address, port] = candidate;

        return {
            sdp: [
                `m=audio ${port} ICE/SDP`,
                `a=fingerprint:${fingerprint}`,
                `c=IN IP4 ${address}`,
                `a=rtcp:${port}`,
                `a=ice-ufrag:${answerAttribute("ice-ufrag")}`,
                `a=ice-pwd:${answerAttribute("ice-pwd")}`,
                `a=fingerprint:${fingerprint}`,
                `a=candidate:1 1 ${protocol.toUpperCase()} ${priority} ${address} ${port} typ host`,
                "",
            ].join("\n"),
            selectedVideoCodec: "H264",
        };
    }

    onClientClose = <T>(webRtcClient: WebRtcClient<T>) => {
        const client = webRtcClient as unknown as PionClient;
        if (client.stopped) return;
        client.stopped = true;
        client.emitter.removeAllListeners();
        const room = this.rooms.get(client.voiceRoomId);
        if (room?.clients.get(client.user_id) === client) room.clients.delete(client.user_id);
        for (const other of room?.clients.values() ?? []) other.outgoing.delete(client.user_id);
        if (room && room.clients.size === 0) this.rooms.delete(client.voiceRoomId);
        this.ipc.send({ type: "leave", clientId: client.uniqueId });
    };

    updateSDP() {}

    getClientsForRtcServer<T>(roomId: string) {
        return new Set([...(this.rooms.get(roomId)?.clients.values() ?? [])] as unknown as WebRtcClient<T>[]);
    }

    async stop() {
        this.stopping = true;
        this.ipc?.close();
        this.process?.kill();
    }
}
