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

import { randomBytes, toB64u } from "./bytes";
import { aesDecrypt, aesEncrypt, exportPublic, generateAgreementKey, generateSigningKey, hpkeOpen, hpkeSeal, sign, verify } from "./crypto";
import { Api, Engine } from "./engine";
import { createHooks, MessageState } from "./hooks";
import { createLink, LinkEvent } from "./link";
import { createUi } from "./ui";
import { HttpClient, scan, Targets } from "./webpack";

interface LoaderState {
    reqs: { c?: Record<string, { exports: unknown }> }[];
    status?: () => unknown;
}

declare global {
    interface Window {
        __fosscordE2ee?: LoaderState;
    }
}

const HOOK_TIMEOUT_MS = 20000;
const UNAVAILABLE = "End-to-end encryption is unavailable in this client build, so sending in encrypted conversations is turned off.";

const loader: LoaderState = (window.__fosscordE2ee ??= { reqs: [] });
const states = new Map<string, { state: MessageState; reason?: string }>();
const targets: Targets = {};
let http: HttpClient | null = null;
let failure: string | null = null;
let settle: (ok: boolean) => void = () => {};
const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
});
let started = false;
let initialized = false;
let lastProbe = 0;

const api: Api = {
    async request<T>(method: "get" | "post" | "put" | "patch" | "del", url: string, body?: unknown) {
        if (!http) throw new Error("HTTP client not found");
        const res = await http[method]({ url, body, rejectWithError: false });
        if (!res.ok) throw res;
        return res.body as T;
    },
};

const engine = new Engine(api);

const link = createLink(engine, api, {
    onPrompt: (prompt) => ui.showApproval(prompt),
    onChange: () => ui.renderUnlock(),
    onDismiss: (requestId) => ui.dismissApproval(requestId),
});

const apiBase = () => {
    const env = (window as unknown as { GLOBAL_ENV?: { API_ENDPOINT?: string; API_VERSION?: number } }).GLOBAL_ENV;
    return `${env?.API_ENDPOINT ?? "/api"}/v${env?.API_VERSION ?? 9}`;
};

const tokenApi = (token: string): Api => ({
    async request<T>(method: "get" | "post" | "put" | "patch" | "del", url: string, body?: unknown) {
        const res = await fetch(`${apiBase()}${url}`, {
            method: method === "del" ? "DELETE" : method.toUpperCase(),
            headers: { "content-type": "application/json", authorization: token },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const parsed = await res.json().catch(() => null);
        if (!res.ok) throw { ok: false, status: res.status, body: parsed };
        return parsed as T;
    },
});

const verifyPassword = async (password: string) => {
    const me = await api.request<{ email?: string | null }>("get", "/users/@me");
    const base = apiBase();
    const res = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: me.email, password }) });
    const body = (await res.json().catch(() => null)) as { token?: string; ticket?: string } | null;
    if (body?.token) await fetch(`${base}/auth/logout`, { method: "POST", headers: { "content-type": "application/json", authorization: body.token }, body: "{}" }).catch(() => {});
    return res.ok && !!(body?.token || body?.ticket);
};

const ui = createUi({
    engine,
    states,
    link,
    verifyPassword,
    enableChannel: async (channelId) => {
        await api.request("put", `/channels/${channelId}/e2ee`, { enabled: true });
        engine.setChannelEncrypted(channelId);
    },
});

const fail = (reason: string) => {
    if (failure) return;
    failure = reason;
    console.error(`[e2ee] ${reason}`);
    ui.fail(UNAVAILABLE);
    settle(false);
};

let readyNow = false;
ready.then((ok) => {
    readyNow = ok;
    if (ok) hooks.retryAll();
});

const hooks = createHooks({
    engine,
    ready,
    states,
    failClosed: () => failure !== null,
    isReady: () => readyNow,
    onCredentials: (path, body, response) => {
        const password = typeof body.password === "string" ? body.password : undefined;
        const next = typeof body.new_password === "string" ? body.new_password : undefined;
        if (path !== "/users/@me") return password && engine.rememberPassword(password);
        if (!next) return;
        const token = (response as { token?: unknown } | null)?.token;
        engine.passwordChanged(password, next, typeof token === "string" ? tokenApi(token) : undefined).catch((error) => console.error("[e2ee] couldn't rewrap the backup", error));
    },
    onState: () => ui.refresh(),
    onError: (error, channelId) => ui.showError(error, channelId),
});

const selfTest = async () => {
    const agreement = await generateAgreementKey();
    const secret = randomBytes(32);
    const sealed = await hpkeSeal(await exportPublic(agreement.publicKey), secret, "self-test", "aad");
    const opened = await hpkeOpen(agreement, sealed.enc, sealed.wrapped, "self-test", "aad");
    if (toB64u(opened) !== toB64u(secret)) throw new Error("HPKE round trip failed");
    const iv = randomBytes(12);
    const ct = await aesEncrypt(secret, iv, secret, "aad");
    if (toB64u(await aesDecrypt(secret, iv, ct, "aad")) !== toB64u(secret)) throw new Error("AES-GCM round trip failed");
    const signing = await generateSigningKey();
    const signature = await sign(signing.privateKey, "self-test");
    if (!(await verify(await exportPublic(signing.publicKey), "self-test", signature))) throw new Error("Ed25519 round trip failed");
    if (await verify(await exportPublic(signing.publicKey), "self-tesT", signature)) throw new Error("Ed25519 accepted a bad signature");
    const prekey = engine.prekeys.reduce((a, b) => (b.id > a.id ? b : a));
    const probe = await hpkeSeal(prekey.publicKey, secret, "self-test", "aad");
    if (toB64u(await hpkeOpen(prekey.keyPair, probe.enc, probe.wrapped, "self-test", "aad")) !== toB64u(secret)) throw new Error("Stored prekey round trip failed");
};

const start = async (userId: string) => {
    if (started || failure) return;
    started = true;
    try {
        await engine.init(userId);
        await selfTest();
        initialized = true;
        engine.onUnlock(() => hooks.retryAll());
        ui.refresh();
        if (engine.locked) {
            link.request().catch((error) => console.error("[e2ee] link request failed", error));
            ui.showUnlock();
        }
    } catch (error) {
        fail(`Self-test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const startWhenReady = () => {
    if (started || !http || Date.now() - lastProbe < 10000) return;
    lastProbe = Date.now();
    api.request<{ id: string }>("get", "/users/@me").then(
        (me) => start(me.id),
        () => {},
    );
};

const received: Record<string, number> = {};
const count = (type: string) => (received[type] = (received[type] ?? 0) + 1);

let selfRefresh: ReturnType<typeof setTimeout> | null = null;
const refreshSelf = (userId: string) => {
    if (userId !== engine.userId || !initialized || selfRefresh) return;
    selfRefresh = setTimeout(() => {
        selfRefresh = null;
        engine.refresh().catch((error) => console.error("[e2ee] refresh failed", error));
    }, 500);
};

const custom = {
    E2EE_DEVICES_UPDATE: (data: Record<string, unknown>) => {
        count("E2EE_DEVICES_UPDATE");
        engine.invalidateUser(String(data.user_id));
        refreshSelf(String(data.user_id));
        ui.refresh();
    },
    E2EE_IDENTITY_UPDATE: (data: Record<string, unknown>) => {
        count("E2EE_IDENTITY_UPDATE");
        engine.invalidateUser(String(data.user_id));
        refreshSelf(String(data.user_id));
        ui.refresh();
    },
    E2EE_LINK_REQUEST: (data: Record<string, unknown>) => {
        count("E2EE_LINK_REQUEST");
        if (initialized) link.onEvent("E2EE_LINK_REQUEST", data as unknown as LinkEvent);
    },
    E2EE_LINK_RESPONSE: (data: Record<string, unknown>) => {
        count("E2EE_LINK_RESPONSE");
        if (initialized) link.onEvent("E2EE_LINK_RESPONSE", data as unknown as LinkEvent);
    },
    CHANNEL_E2EE_UPDATE: (data: Record<string, unknown>) => {
        count("CHANNEL_E2EE_UPDATE");
        if (data.enabled) engine.setChannelEncrypted(String(data.channel_id));
    },
};

const installed = { dispatcher: false, http: false, gateway: false };
const startedAt = Date.now();

const tick = () => {
    if (failure) return;
    scan(loader.reqs, targets);
    if (targets.http && !installed.http) {
        installed.http = true;
        const originals = hooks.wrapHttp(targets.http);
        http = originals;
    }
    if (targets.dispatcher && !installed.dispatcher) {
        installed.dispatcher = true;
        hooks.watchDispatcher(targets.dispatcher);
        targets.dispatcher.subscribe("CONNECTION_OPEN", (action) => {
            const user = action.user as { id?: string } | undefined;
            if (user?.id) start(user.id);
            else startWhenReady();
        });
        targets.dispatcher.subscribe("CHANNEL_RECIPIENT_ADD", (action) => engine.invalidateChannel(String(action.channelId)));
        targets.dispatcher.subscribe("CHANNEL_RECIPIENT_REMOVE", (action) => engine.invalidateChannel(String(action.channelId)));
    }
    if (targets.gateway && !installed.gateway && targets.gateway.getSocket().dispatcher.getDispatchHandler) {
        installed.gateway = true;
        hooks.wrapGateway(targets.gateway, custom);
    }
    if (installed.http && installed.dispatcher && installed.gateway) {
        if (initialized) return settle(true);
        if (!started && Date.now() - startedAt > 8000) startWhenReady();
    } else if (Date.now() - startedAt > HOOK_TIMEOUT_MS) {
        const missing = Object.entries(installed)
            .filter(([, ok]) => !ok)
            .map(([name]) => name);
        return fail(`Couldn't find ${missing.join(", ")} in this client build`);
    }
    setTimeout(tick, installed.http && installed.dispatcher ? 100 : 20);
};

loader.status = () => ({
    ready: initialized && !failure && installed.http && installed.dispatcher && installed.gateway,
    failure,
    userId: engine.userId,
    deviceId: engine.device?.deviceId ?? null,
    deviceStatus: engine.deviceStatus,
    linked: engine.linked,
    locked: engine.locked,
    holdsIdentity: !!engine.identity,
    trustedKey: engine.trustedKey,
    hasSecret: engine.hasSecret,
    backup: engine.backup ? { mode: engine.backup.mode, version: engine.backup.version, hasSecret: !!engine.backup.wrapped_secret, identityKey: engine.backup.identity_key } : null,
    link: link.outgoing(),
    hooks: { ...installed },
    encryptedChannels: [...engine.encryptedChannels],
    states: Object.fromEntries(states),
    received: { ...received },
});

tick();
