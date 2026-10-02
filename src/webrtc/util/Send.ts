import { JSONReplacer } from "@spacebar/util";
import { VoiceOPCodes, VoicePayload } from "./Constants";
import { WebRtcWebSocket } from "./WebRtcWebSocket";

const unsequenced = new Set([VoiceOPCodes.HELLO, VoiceOPCodes.HEARTBEAT_ACK, VoiceOPCodes.RESUMED]);

const write = (socket: WebRtcWebSocket, buffer: Buffer | string) =>
    new Promise((res, rej) => {
        if (socket.readyState !== 1) return res(null);
        socket.send(buffer, (err) => (err ? rej(err) : res(null)));
    });

const nextSequence = (socket: WebRtcWebSocket) => {
    socket.voiceSequence = ((socket.voiceSequence ?? 0) + 1) & 0xffff;
    return socket.voiceSequence;
};

export function Send(socket: WebRtcWebSocket, data: VoicePayload) {
    if (process.env.WRTC_WS_VERBOSE) console.log(`[WebRTC] Outgoing message: ${JSON.stringify(data)}`);
    if (socket.encoding !== "json") return;

    const payload = socket.version >= 8 && !unsequenced.has(data.op) ? { ...data, seq: nextSequence(socket) } : data;
    return write(socket, JSON.stringify(payload, JSONReplacer));
}

export function SendBinary(socket: WebRtcWebSocket, op: VoiceOPCodes, payload: Buffer) {
    if (process.env.WRTC_WS_VERBOSE) console.log(`[WebRTC] Outgoing binary op ${op} (${payload.length} bytes)`);
    if (socket.version < 8) return write(socket, Buffer.concat([Buffer.from([op]), payload]));

    const header = Buffer.alloc(3);
    header.writeUInt16BE(nextSequence(socket), 0);
    header.writeUInt8(op, 2);
    return write(socket, Buffer.concat([header, payload]));
}
