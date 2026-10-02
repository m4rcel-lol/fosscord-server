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
    readonly outgoing = new Map<string, SSRCs>();

    constructor(
        readonly user_id: string,
        readonly voiceRoomId: string,
        readonly websocket: unknown,
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
        return !!this.incoming.audio_ssrc;
    }

    isProducingVideo() {
        return !!this.incoming.video_ssrc;
    }

    async publishTrack(type: "audio" | "video", ssrcs: SSRCs) {
        if (type === "audio") this.incoming.audio_ssrc = ssrcs.audio_ssrc;
        else this.incoming = { ...ssrcs, audio_ssrc: this.incoming.audio_ssrc };
        this.server.ipc.send({ type: "publish", clientId: this.uniqueId, trackType: type });
    }

    stopPublishingTrack(type: "audio" | "video") {
        if (type === "audio") this.incoming.audio_ssrc = undefined;
        else this.incoming = { audio_ssrc: this.incoming.audio_ssrc };
        this.server.ipc.send({ type: "stop-publish", clientId: this.uniqueId, trackType: type });
    }

    async subscribeToTrack(userId: string, type: "audio" | "video") {
        const publisher = this.server.findClient(this.voiceRoomId, userId);
        if (!publisher) return;
        const result = await this.server.ipc.request({ type: "subscribe", clientId: this.uniqueId, publisherId: publisher.uniqueId, trackType: type }).catch((error) => {
            console.log(`[WebRTC] ${this.user_id} could not subscribe to ${type} of ${userId}: ${error.message}`);
            return undefined;
        });
        if (!result?.ssrc) return;
        const ssrcs = this.outgoing.get(userId) ?? {};
        if (type === "audio") ssrcs.audio_ssrc = result.ssrc;
        else {
            ssrcs.video_ssrc = result.ssrc;
            ssrcs.rtx_ssrc = publisher.getIncomingStreamSSRCs().rtx_ssrc;
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
        this.ipc = new IpcClient(socketPath, (payload) => this.onEvent(payload));
        if (process.env.PION_SFU_BIN) this.spawn(socketPath);
        await this.ipc.connect();
        console.log(`[WebRTC] connected to pion SFU at ${socketPath}, media on udp ${publicIp}:${portMin}`);
    }

    private spawn(socketPath: string) {
        const child = spawn(process.env.PION_SFU_BIN!, ["-port", String(this._port), "-ip", this._ip, "-ipc", socketPath, ...(process.env.PION_SFU_VERBOSE ? ["-verbose"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
        const log = (data: Buffer) => process.env.PION_SFU_VERBOSE && console.log(`[Pion SFU] ${data.toString().trimEnd()}`);
        child.stdout?.on("data", log);
        child.stderr?.on("data", log);
        child.once("exit", (code) => {
            console.log(`[WebRTC] pion SFU exited with code ${code}`);
            this.ipc.close();
            for (const room of this.rooms.values()) for (const client of room.clients.values()) (client.websocket as { close?: (code: number) => void }).close?.(4015);
            this.rooms.clear();
            if (this.stopping) return;
            setTimeout(() => {
                this.spawn(socketPath);
                this.ipc.connect().catch((error) => console.error("[WebRTC] could not reconnect to pion SFU", error));
            }, 1000);
        });
        this.process = child;
        process.once("exit", () => child.kill());
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
        const transport = [`a=ice-ufrag:${attribute("ice-ufrag")}`, `a=ice-pwd:${attribute("ice-pwd")}`, `a=fingerprint:${attribute("fingerprint")}`, "a=setup:active", "a=rtcp-mux"];

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
            `a=fmtp:${opus} minptime=10;usedtx=1;useinbandfec=1`,
            `m=video 9 UDP/TLS/RTP/SAVPF ${videoPayload} ${rtxPayload}`,
            "c=IN IP4 0.0.0.0",
            ...transport,
            "a=mid:1",
            "a=sendrecv",
            ...extmap(VIDEO_EXTENSIONS),
            `a=rtpmap:${videoPayload} H264/90000`,
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
