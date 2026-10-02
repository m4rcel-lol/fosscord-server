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

export type HttpMethod = "get" | "post" | "put" | "patch" | "del";

export interface HttpResponse {
    ok: boolean;
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}

export type HttpOptions = { url: string; body?: unknown; query?: unknown; rejectWithError?: boolean; attachments?: unknown[] } & Record<string, unknown>;

export type HttpCall = (opts: HttpOptions | string, callback?: (res: HttpResponse & { hasErr?: boolean; err?: unknown }) => void) => Promise<HttpResponse>;

export type HttpClient = Record<HttpMethod, HttpCall>;

export interface FluxAction {
    type: string;
    [key: string]: unknown;
}

export interface Dispatcher {
    addInterceptor(fn: (action: FluxAction) => boolean | void): void;
    dispatch(action: FluxAction): unknown;
    subscribe(type: string, fn: (action: FluxAction) => void): void;
}

export interface DispatchHandler {
    preload: (data: unknown) => Promise<unknown> | null | undefined;
    dispatch: (data: unknown, ...rest: unknown[]) => void;
}

export interface GatewaySocket {
    dispatcher: { getDispatchHandler: ((type: string) => DispatchHandler | undefined) | null };
    isSessionEstablished?: () => boolean;
}

export interface GatewayStore {
    getSocket(): GatewaySocket;
}

export interface Targets {
    dispatcher?: Dispatcher;
    http?: HttpClient;
    gateway?: GatewayStore;
}

interface WebpackRequire {
    c?: Record<string, { exports: unknown }>;
}

const keysOf = (value: unknown) => {
    try {
        return value && (typeof value === "object" || typeof value === "function") ? Object.keys(value) : [];
    } catch {
        return [];
    }
};

const protoKeysOf = (value: unknown) => {
    try {
        const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        return proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
    } catch {
        return [];
    }
};

const pickRequire = (reqs: WebpackRequire[]) =>
    reqs.filter((r) => r.c).reduce<WebpackRequire | null>((best, r) => (!best || Object.keys(r.c!).length > Object.keys(best.c!).length ? r : best), null);

export const scan = (reqs: WebpackRequire[], found: Targets) => {
    const req = pickRequire(reqs);
    if (!req?.c) return found;
    for (const id of Object.keys(req.c)) {
        if (found.dispatcher && found.http && found.gateway) break;
        const exports = req.c[id]?.exports;
        for (const name of keysOf(exports)) {
            let value: unknown;
            try {
                value = (exports as Record<string, unknown>)[name];
            } catch {
                continue;
            }
            if (!value || typeof value !== "object") continue;
            const own = keysOf(value);
            const proto = protoKeysOf(value);
            const all = new Set([...own, ...proto]);
            if (!found.dispatcher && ["addInterceptor", "dispatch", "subscribe"].every((k) => all.has(k))) found.dispatcher = value as Dispatcher;
            else if (
                !found.http &&
                own.length <= 6 &&
                (["get", "post", "put", "patch", "del"] as const).every((k) => own.includes(k) && typeof (value as HttpClient)[k] === "function")
            )
                found.http = value as HttpClient;
            else if (!found.gateway && proto.includes("getSocket") && proto.includes("isTryingToConnect")) {
                try {
                    const socket = (value as GatewayStore).getSocket();
                    if (socket && keysOf(socket.dispatcher).includes("getDispatchHandler")) found.gateway = value as GatewayStore;
                } catch {
                    continue;
                }
            }
        }
    }
    return found;
};

export const findStore = <T>(reqs: WebpackRequire[], methods: string[]): T | null => {
    const req = pickRequire(reqs);
    if (!req?.c) return null;
    for (const id of Object.keys(req.c)) {
        const exports = req.c[id]?.exports;
        for (const name of keysOf(exports)) {
            let value: unknown;
            try {
                value = (exports as Record<string, unknown>)[name];
            } catch {
                continue;
            }
            if (!value || typeof value !== "object") continue;
            const proto = protoKeysOf(value);
            if (methods.every((m) => proto.includes(m))) return value as T;
        }
    }
    return null;
};
