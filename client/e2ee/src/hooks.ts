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

import { E2eeError, Engine, FALLBACK_CONTENT, RawMessage } from "./engine";
import { DispatchHandler, Dispatcher, FluxAction, GatewayStore, HttpCall, HttpClient, HttpMethod, HttpOptions, HttpResponse } from "./webpack";

export type MessageState = "decrypted" | "pending" | "missing" | "failed";

export const DECRYPTING_CONTENT = "Decrypting…";
export const MISSING_CONTENT = "Sent before this browser was set up";

export interface HookContext {
    engine: Engine;
    ready: Promise<boolean>;
    states: Map<string, { state: MessageState; reason?: string }>;
    failClosed: () => boolean;
    isReady: () => boolean;
    onState: () => void;
    onCredentials: (path: string, body: { password?: unknown; new_password?: unknown }, response: unknown) => void;
    onError: (error: unknown, channelId: string) => void;
}

const AUTH_URL = /^\/auth\/(login|register)$/;

const MESSAGE_URL = /^\/channels\/(\d+)\/messages(?:\/(\d+))?$/;

const isEncryptedMessage = (value: unknown): value is RawMessage & { encrypted: NonNullable<RawMessage["encrypted"]> } => {
    const message = value as RawMessage | null;
    return !!message && typeof message === "object" && !!message.encrypted && typeof message.id === "string" && typeof message.channel_id === "string";
};

const collect = (value: unknown, out: RawMessage[], depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6) return out;
    if (Array.isArray(value)) {
        value.forEach((item) => collect(item, out, depth + 1));
        return out;
    }
    if (isEncryptedMessage(value)) out.push(value);
    for (const key of Object.keys(value)) {
        const child = (value as Record<string, unknown>)[key];
        if (child && typeof child === "object" && key !== "encrypted") collect(child, out, depth + 1);
    }
    return out;
};

export const createHooks = (ctx: HookContext) => {
    const { engine, states } = ctx;
    const inflight = new Map<string, Promise<void>>();

    const retry = new Map<string, RawMessage>();
    let dispatcher: Dispatcher | null = null;
    const clone = (message: RawMessage) => JSON.parse(JSON.stringify(message)) as RawMessage;

    const decryptOne = (message: RawMessage) => {
        const key = `${message.id}:${message.encrypted?.sig}`;
        const sync = engine.cached(message);
        if (sync !== undefined) {
            message.content = sync;
            states.set(message.id, { state: "decrypted" });
            retry.delete(message.id);
            return Promise.resolve();
        }
        if (!ctx.isReady()) {
            if (ctx.failClosed()) {
                states.set(message.id, { state: "failed", reason: "Encryption is unavailable in this client build" });
                message.content = FALLBACK_CONTENT;
            } else {
                retry.set(message.id, clone(message));
                states.set(message.id, { state: "pending" });
                message.content = DECRYPTING_CONTENT;
            }
            return Promise.resolve();
        }
        let pending = inflight.get(key);
        if (!pending) {
            const original = clone(message);
            pending = (async () => {
                try {
                    const content = await engine.decrypt(message);
                    states.set(message.id, { state: "decrypted" });
                    retry.delete(message.id);
                    message.content = content;
                } catch (error) {
                    const code = error instanceof E2eeError ? error.code : null;
                    if (code === "LOCKED" || code === "NO_KEY") {
                        states.set(message.id, { state: "missing", reason: error instanceof Error ? error.message : String(error) });
                        retry.set(message.id, original);
                        message.content = MISSING_CONTENT;
                    } else {
                        states.set(message.id, { state: "failed", reason: error instanceof Error ? error.message : String(error) });
                        message.content = FALLBACK_CONTENT;
                    }
                }
            })().finally(() => inflight.delete(key));
            inflight.set(key, pending);
            return pending.then(() => ctx.onState());
        }
        return pending.then(() => {
            const again = engine.cached(message);
            const state = states.get(message.id)?.state;
            message.content = again ?? (state === "missing" ? MISSING_CONTENT : state === "failed" ? FALLBACK_CONTENT : message.content);
            ctx.onState();
        });
    };

    const retryAll = () => {
        if (!ctx.isReady()) return;
        const queued = [...retry.values()];
        retry.clear();
        for (const copy of queued) {
            const before = states.get(copy.id)?.state;
            decryptOne(copy).then(() => {
                const after = states.get(copy.id)?.state;
                if (after === before && after !== "pending") return;
                dispatcher?.dispatch({ type: "MESSAGE_UPDATE", message: copy, e2eeLocal: true });
                ctx.onState();
            });
        }
    };

    const decryptAll = async (value: unknown) => {
        const messages = collect(value, []);
        if (messages.length) await Promise.all(messages.map(decryptOne));
    };

    const encryptBody = async (method: HttpMethod, opts: HttpOptions) => {
        const match = MESSAGE_URL.exec(opts.url.split("?")[0]);
        if (!match || (method !== "post" && method !== "patch")) return opts;
        const [, channelId, messageId] = match;
        if (method === "post" && messageId) return opts;
        if (!engine.isEncrypted(channelId)) return opts;
        if (ctx.failClosed()) throw new E2eeError("NOT_READY", "Encryption is unavailable in this client build");
        if (!(await ctx.ready)) throw new E2eeError("NOT_READY", "Encryption is unavailable in this client build");
        const body = { ...((opts.body ?? {}) as Record<string, unknown>) };
        if (method === "patch" && body.content === undefined) return opts;
        if (opts.attachments?.length || (body.attachments as unknown[] | undefined)?.length || (body.sticker_ids as unknown[] | undefined)?.length || body.poll)
            throw new E2eeError("UNSUPPORTED", "Attachments, stickers and polls can't be sent in encrypted conversations yet");
        const nonce = method === "post" ? String(body.nonce ?? `${Date.now()}${Math.floor(Math.random() * 1000)}`) : undefined;
        if (nonce) body.nonce = nonce;
        body.encrypted = await engine.encrypt(channelId, String(body.content ?? ""), { nonce, mid: method === "patch" ? messageId : undefined });
        body.content = FALLBACK_CONTENT;
        return { ...opts, body };
    };

    const wrapHttp = (http: HttpClient) => {
        const originals = { ...http };
        for (const method of ["get", "post", "put", "patch", "del"] as HttpMethod[]) {
            const original = originals[method];
            const wrapped: HttpCall = (input, callback) => {
                const opts: HttpOptions = typeof input === "string" ? { url: input, rejectWithError: false } : input;
                const url = typeof opts?.url === "string" ? opts.url : "";
                const path = url.split("?")[0];
                if ((method === "post" && AUTH_URL.test(path)) || (method === "patch" && path === "/users/@me")) {
                    const body = (opts.body ?? {}) as { password?: unknown; new_password?: unknown };
                    const result = original(input, callback);
                    result.then(
                        (res) => res?.ok && ctx.onCredentials(path, body, res.body),
                        () => {},
                    );
                    return result;
                }
                const relevant = url.startsWith("/channels/") || url.startsWith("/users/@me/mentions") || url.includes("/messages");
                if (!relevant) return original(input, callback);
                return (async () => {
                    let prepared: HttpOptions;
                    try {
                        prepared = await encryptBody(method, opts);
                    } catch (error) {
                        const match = MESSAGE_URL.exec(url.split("?")[0]);
                        ctx.onError(error, match?.[1] ?? "");
                        callback?.({ ok: false, hasErr: true, err: error, status: 0, body: null });
                        throw error;
                    }
                    for (let attempt = 0; ; attempt++) {
                        let response: (HttpResponse & { hasErr?: boolean }) | undefined;
                        try {
                            const result = await original(prepared, (res) => (response = res));
                            await decryptAll(result?.body);
                            callback?.(response ?? { ...result, hasErr: false });
                            return result;
                        } catch (error) {
                            const failure = error as { status?: number; body?: { message?: string } };
                            if (attempt === 0 && failure?.status === 409 && failure.body?.message === "E2EE_DEVICE_MISMATCH" && prepared !== opts) {
                                const match = MESSAGE_URL.exec(url.split("?")[0])!;
                                engine.invalidateChannel(match[1]);
                                engine.invalidateAll();
                                prepared = await encryptBody(method, opts);
                                continue;
                            }
                            if (response) callback?.(response);
                            throw error;
                        }
                    }
                })();
            };
            http[method] = wrapped;
        }
        return originals;
    };

    const wrapGateway = (store: GatewayStore, custom: Record<string, (data: Record<string, unknown>) => void>) => {
        const socketDispatcher = store.getSocket().dispatcher;
        let current = socketDispatcher.getDispatchHandler;
        const cache = new Map<string, { base: DispatchHandler | undefined; wrapped: DispatchHandler | undefined }>();
        const wrap = (type: string) => {
            const base = current?.(type);
            const hit = cache.get(type);
            if (hit && hit.base === base) return hit.wrapped;
            let wrapped = base;
            if (custom[type]) wrapped = { preload: () => null, dispatch: (data) => custom[type](data as Record<string, unknown>) };
            else if (base && (type === "MESSAGE_CREATE" || type === "MESSAGE_UPDATE")) {
                wrapped = {
                    ...base,
                    preload: (data) => {
                        const own = base.preload(data);
                        if (!collect(data, []).length) return own;
                        return Promise.all([own, decryptAll(data)]).then(([result]) => result);
                    },
                    dispatch: (...args) => base.dispatch(...args),
                };
            }
            cache.set(type, { base, wrapped });
            return wrapped;
        };
        Object.defineProperty(socketDispatcher, "getDispatchHandler", {
            configurable: true,
            get: () => (current ? wrap : null),
            set: (value) => {
                current = value;
                cache.clear();
            },
        });
    };

    const watchDispatcher = (target: Dispatcher) => {
        dispatcher = target;
        target.addInterceptor((action: FluxAction) => {
            if ((action as { e2eeLocal?: boolean }).e2eeLocal || !/MESSAGE|SEARCH|PIN|MENTION|THREAD/.test(action.type)) return false;
            const messages = collect(action, []).filter((m) => m.content === FALLBACK_CONTENT && !states.has(m.id));
            for (const message of messages) {
                const hit = engine.cached(message);
                if (hit !== undefined) {
                    message.content = hit;
                    states.set(message.id, { state: "decrypted" });
                    continue;
                }
                const copy = clone(message);
                message.content = DECRYPTING_CONTENT;
                decryptOne(copy).then(() => {
                    if (states.get(copy.id)?.state === "pending") return;
                    target.dispatch({ type: "MESSAGE_UPDATE", message: copy, e2eeLocal: true });
                });
            }
            return false;
        });
    };

    return { wrapHttp, wrapGateway, watchDispatcher, decryptAll, retryAll };
};
