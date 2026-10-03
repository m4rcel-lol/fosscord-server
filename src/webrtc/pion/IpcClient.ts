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

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

export interface IpcPayload {
    type: string;
    clientId: string;
    sdp?: string;
    trackType?: "audio" | "video";
    publisherId?: string;
    ssrc?: number;
    blockAudio?: boolean;
    blockVideo?: boolean;
    deaf?: boolean;
}

interface IpcMessage {
    id: string;
    type: "request" | "response" | "ping" | "pong";
    payload: IpcPayload;
    error?: string;
}

export class IpcClient {
    private socket?: net.Socket;
    private buffer = Buffer.alloc(0);
    private pending = new Map<string, { resolve: (payload: IpcPayload) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();

    constructor(
        readonly socketPath: string,
        private readonly onEvent: (payload: IpcPayload) => void,
        private readonly onClose?: () => void,
    ) {}

    get connected() {
        return this.socket?.readyState === "open";
    }

    async connect(timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                await this.tryConnect();
                return;
            } catch (error) {
                if (Date.now() > deadline) throw error;
                await sleep(250);
            }
        }
    }

    private tryConnect() {
        return new Promise<void>((resolve, reject) => {
            const socket = net.createConnection(this.socketPath);
            socket.once("connect", () => {
                this.socket = socket;
                this.buffer = Buffer.alloc(0);
                socket.on("data", (chunk: Buffer) => this.onData(chunk));
                socket.on("close", () => {
                    this.rejectAll(new Error("IPC connection closed"));
                    if (this.socket === socket) this.socket = undefined;
                    this.onClose?.();
                });
                resolve();
            });
            socket.once("error", (error) => {
                socket.destroy();
                reject(error);
            });
        });
    }

    private onData(chunk: Buffer) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            if (this.buffer.length < 4 + length) break;
            const body = this.buffer.subarray(4, 4 + length);
            this.buffer = this.buffer.subarray(4 + length);
            this.onMessage(JSON.parse(body.toString()) as IpcMessage);
        }
    }

    private onMessage(message: IpcMessage) {
        const request = message.id ? this.pending.get(message.id) : undefined;
        if (message.type === "response" && request) {
            clearTimeout(request.timeout);
            this.pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve(message.payload);
            return;
        }
        if (message.type === "ping") return this.write({ type: "pong", clientId: message.payload?.clientId ?? "" }, message.id, "pong");
        if (message.payload) this.onEvent(message.payload);
    }

    request(payload: IpcPayload, timeoutMs = 10000) {
        return new Promise<IpcPayload>((resolve, reject) => {
            if (!this.connected) {
                reject(new Error("SFU IPC socket is not connected"));
                return;
            }
            const id = randomUUID();
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`SFU IPC request ${payload.type} timed out`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timeout });
            this.write(payload, id);
        });
    }

    send(payload: IpcPayload) {
        if (this.connected) this.write(payload, randomUUID());
    }

    private write(payload: IpcPayload, id: string, type: IpcMessage["type"] = "request") {
        const body = Buffer.from(JSON.stringify({ id, type, payload } satisfies IpcMessage));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length);
        this.socket?.write(Buffer.concat([header, body]));
    }

    private rejectAll(error: Error) {
        for (const request of this.pending.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }
        this.pending.clear();
    }

    close() {
        this.rejectAll(new Error("IPC connection closed"));
        this.socket?.end();
        this.socket = undefined;
    }
}
