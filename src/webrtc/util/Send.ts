import { JSONReplacer } from "@spacebar/util";
import { VoiceOPCodes, VoicePayload } from "./Constants";
import { WebRtcWebSocket } from "./WebRtcWebSocket";

const unsequenced = new Set([VoiceOPCodes.HELLO, VoiceOPCodes.HEARTBEAT_ACK, VoiceOPCodes.RESUMED]);
const REPLAY_BUFFER_SIZE = 256;

export const write = (socket: WebRtcWebSocket, buffer: Buffer | string) =>
    new Promise((res) => {
        if (socket.readyState === 1) socket.send(buffer, () => res(null));
        else res(null);
    });

export const currentSocket = (socket: WebRtcWebSocket) => {
    while (socket.resumedBy) socket = socket.resumedBy;
    return socket;
};

const nextSequence = (socket: WebRtcWebSocket) => {
    socket.voiceSequence = ((socket.voiceSequence ?? 0) + 1) & 0xffff;
    return socket.voiceSequence;
};

const remember = (socket: WebRtcWebSocket, seq: number, data: string | Buffer) => {
    socket.sentMessages ??= [];
    socket.sentMessages.push({ seq, data });
    if (socket.sentMessages.length > REPLAY_BUFFER_SIZE) socket.sentMessages.shift();
};

export function Send(target: WebRtcWebSocket, data: VoicePayload) {
    const socket = currentSocket(target);
    if (process.env.WRTC_WS_VERBOSE) console.log(`[WebRTC] Outgoing message: ${JSON.stringify(data)}`);
    if (socket.encoding !== "json") return;

    if (socket.version < 8 || unsequenced.has(data.op)) return write(socket, JSON.stringify(data, JSONReplacer));
    const seq = nextSequence(socket);
    const message = JSON.stringify({ ...data, seq }, JSONReplacer);
    remember(socket, seq, message);
    return write(socket, message);
}

export function SendBinary(target: WebRtcWebSocket, op: VoiceOPCodes, payload: Buffer) {
    const socket = currentSocket(target);
    if (process.env.WRTC_WS_VERBOSE) console.log(`[WebRTC] Outgoing binary op ${op} (${payload.length} bytes)`);
    if (socket.version < 8) return write(socket, Buffer.concat([Buffer.from([op]), payload]));

    const seq = nextSequence(socket);
    const header = Buffer.alloc(3);
    header.writeUInt16BE(seq, 0);
    header.writeUInt8(op, 2);
    const message = Buffer.concat([header, payload]);
    remember(socket, seq, message);
    return write(socket, message);
}
