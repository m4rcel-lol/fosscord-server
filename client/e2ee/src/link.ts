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

import { fromB64u, randomBytes, sha256, toB64u, utf8 } from "./bytes";
import { aesDecrypt, aesEncrypt, exportPublic, generateAgreementKey, hkdf, x25519 } from "./crypto";
import { Api, deviceLabel, deviceName, Engine, errorText } from "./engine";

export interface LinkEvent {
    request_id: string;
    stage: "request" | "offer" | "reveal" | "approve" | "deny" | "cancel" | "invite";
    device_id: string;
    to_device: string | null;
    name: string | null;
    commit: string | null;
    public_key: string | null;
    iv: string | null;
    ct: string | null;
}

export type OutgoingState = "waiting" | "comparing" | "denied" | "failed" | "done";

export interface Approver {
    name: string;
    sas: string;
}

export interface Outgoing {
    requestId: string;
    state: OutgoingState;
    approvers: Approver[];
    error: string | null;
}

export interface Incoming {
    requestId: string;
    name: string;
    sas: string;
    approve: () => Promise<void>;
    deny: () => Promise<void>;
}

interface PromptInfo {
    requestId: string;
    name: string;
    sas: string;
}

type TabMessage =
    | { type: "hello" }
    | { type: "request" }
    | { type: "cancel" }
    | { type: "unlocked" }
    | { type: "reset" }
    | { type: "outgoing"; value: Outgoing | null }
    | { type: "prompt"; prompt: PromptInfo }
    | { type: "respond"; requestId: string; stage: "approve" | "deny" }
    | { type: "dismiss"; requestId: string; error?: string };

interface Offer {
    key: string;
    name: string;
    sas: string | null;
}

interface OutgoingInternal {
    requestId: string;
    state: OutgoingState;
    error: string | null;
    pair: CryptoKeyPair;
    publicKey: string;
    offers: Map<string, Offer>;
    revealed: boolean;
    approved: boolean;
}

interface IncomingInternal {
    deviceId: string;
    name: string;
    commit: string;
    pair: CryptoKeyPair;
    publicKey: string;
    requester: string | null;
}

export interface LinkHooks {
    onPrompt: (prompt: Incoming) => void;
    onChange: () => void;
    onDismiss: (requestId: string) => void;
    onPeerUnlock: () => void;
    onPeerReset: () => void;
    beacon: (body: Record<string, unknown>) => void;
}

const OFFER_WINDOW_MS = 1200;
const MAX_APPROVERS = 4;

const sasFor = async (requestId: string, requester: string, approver: string) => {
    const digest = await sha256(utf8(`fosscord-e2ee/v1/sas\n${requestId}\n${requester}\n${approver}`));
    const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
    const digits = String(value % 1000000).padStart(6, "0");
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
};

const channelKey = async (pair: CryptoKeyPair, peer: string, requestId: string) => hkdf(await x25519(pair.privateKey, peer), utf8(requestId), "fosscord-e2ee/v1/link");

const channelAad = (requestId: string, requester: string, approver: string) => `fosscord-e2ee/v1/link\n${requestId}\n${requester}\n${approver}`;

export const createLink = (engine: Engine, api: Api, hooks: LinkHooks) => {
    let outgoing: OutgoingInternal | null = null;
    let remote: Outgoing | null = null;
    let requesting: Promise<void> | null = null;
    let leader = false;
    let wanted = false;
    let stopped = false;
    let release: (() => void) | null = null;
    let channel: BroadcastChannel | null = null;
    const incoming = new Map<string, IncomingInternal>();
    const prompts = new Map<string, PromptInfo>();
    const remotePrompts = new Set<string>();
    const responders = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

    const send = (message: TabMessage) => channel?.postMessage(message);

    const snapshot = (): Outgoing | null =>
        outgoing
            ? {
                  requestId: outgoing.requestId,
                  state: outgoing.state,
                  approvers: [...outgoing.offers.values()].flatMap(({ name, sas }) => (sas ? [{ name, sas }] : [])),
                  error: outgoing.error,
              }
            : null;

    const changed = () => {
        if (leader) send({ type: "outgoing", value: snapshot() });
        hooks.onChange();
    };

    const post = (body: Record<string, unknown>) => api.request("post", "/users/@me/e2ee/link", { ...body, device_id: engine.device!.deviceId });

    const dismiss = (requestId: string, error?: string) => {
        prompts.delete(requestId);
        hooks.onDismiss(requestId);
        send({ type: "dismiss", requestId, error });
    };

    const begin = async () => {
        const pair = await generateAgreementKey();
        const publicKey = await exportPublic(pair.publicKey);
        if (!engine.device || engine.linked || stopped) return;
        const current: OutgoingInternal = {
            requestId: toB64u(randomBytes(16)),
            state: "waiting",
            error: null,
            pair,
            publicKey,
            offers: new Map(),
            revealed: false,
            approved: false,
        };
        outgoing = current;
        changed();
        const body = { request_id: current.requestId, stage: "request", name: deviceName(), commit: toB64u(await sha256(fromB64u(publicKey))) };
        await post(body);
        let attempts = 0;
        const timer = setInterval(() => {
            if (outgoing !== current || current.state !== "waiting" || current.offers.size || engine.linked || stopped || ++attempts > 30) return clearInterval(timer);
            post(body).catch(() => {});
        }, 10000);
    };

    const request = (): Promise<void> => {
        wanted = true;
        if (stopped) return Promise.resolve();
        if (!leader) {
            send({ type: "request" });
            return Promise.resolve();
        }
        if (!engine.device || engine.linked) return Promise.resolve();
        if (requesting) return requesting;
        if (outgoing && (outgoing.state === "waiting" || outgoing.state === "comparing")) return Promise.resolve();
        requesting = begin().finally(() => {
            requesting = null;
        });
        return requesting;
    };

    const cancel = async () => {
        wanted = false;
        if (!leader) return void send({ type: "cancel" });
        const current = outgoing;
        if (!current) return;
        outgoing = null;
        changed();
        if (current.state !== "done" && !current.approved && engine.device) await post({ request_id: current.requestId, stage: "cancel" }).catch(() => {});
    };

    const forgetOutgoing = () => {
        outgoing = null;
        remote = null;
        changed();
    };

    const reveal = async (current: OutgoingInternal) => {
        if (outgoing !== current || current.revealed || current.state !== "waiting") return;
        current.revealed = true;
        for (const offer of current.offers.values()) offer.sas = await sasFor(current.requestId, current.publicKey, offer.key);
        current.state = "comparing";
        changed();
        await Promise.all([...current.offers.keys()].map((to) => post({ request_id: current.requestId, stage: "reveal", to_device: to, public_key: current.publicKey })));
    };

    const onRequest = async (event: LinkEvent) => {
        if (!engine.device || event.device_id === engine.device.deviceId || !engine.linked || !engine.exportSecret() || !event.commit) return;
        if (incoming.has(event.request_id) || incoming.size > 8) return;
        const pair = await generateAgreementKey();
        const publicKey = await exportPublic(pair.publicKey);
        if (incoming.has(event.request_id)) return;
        incoming.set(event.request_id, { deviceId: event.device_id, name: event.name ?? "a new browser", commit: event.commit, pair, publicKey, requester: null });
        setTimeout(
            () => {
                if (incoming.delete(event.request_id) && prompts.has(event.request_id)) dismiss(event.request_id);
            },
            10 * 60 * 1000,
        );
        await post({ request_id: event.request_id, stage: "offer", to_device: event.device_id, public_key: publicKey });
    };

    const respond = async (requestId: string, stage: "approve" | "deny") => {
        const pending = incoming.get(requestId);
        if (!pending?.requester || !incoming.delete(requestId)) return;
        const requester = pending.requester;
        try {
            if (stage === "deny") await post({ request_id: requestId, stage, to_device: pending.deviceId });
            else {
                const secret = engine.exportSecret();
                if (!secret) throw new Error("This browser can't approve logins");
                const key = await channelKey(pending.pair, requester, requestId);
                const iv = randomBytes(12);
                const ct = await aesEncrypt(key, iv, secret, channelAad(requestId, requester, pending.publicKey));
                await post({ request_id: requestId, stage, to_device: pending.deviceId, iv: toB64u(iv), ct: toB64u(ct) });
            }
            dismiss(requestId);
        } catch (error) {
            dismiss(requestId, errorText(error));
            throw error;
        }
    };

    const onResponse = async (event: LinkEvent) => {
        const mine = engine.device?.deviceId;
        if (!mine) return;
        if ((event.stage === "approve" || event.stage === "deny") && event.device_id !== mine && event.to_device !== mine && incoming.has(event.request_id)) {
            incoming.delete(event.request_id);
            if (prompts.has(event.request_id)) dismiss(event.request_id);
            return;
        }
        if (event.to_device !== mine) return;
        if (event.stage === "invite") {
            if (engine.locked) request().catch((error) => console.error("[e2ee] link request failed", error));
            return;
        }
        const current = outgoing?.requestId === event.request_id ? outgoing : null;

        if (event.stage === "offer" && current && !current.revealed && event.public_key && !current.offers.has(event.device_id) && current.offers.size < MAX_APPROVERS) {
            const first = !current.offers.size;
            current.offers.set(event.device_id, { key: event.public_key, name: deviceLabel(engine.devices, event.device_id, "Your other browser"), sas: null });
            if (first) setTimeout(() => reveal(current).catch((error) => console.error("[e2ee] link", error)), OFFER_WINDOW_MS);
            return;
        }

        if (event.stage === "reveal" && event.public_key) {
            const pending = incoming.get(event.request_id);
            if (!pending || pending.deviceId !== event.device_id || pending.requester) return;
            if (toB64u(await sha256(fromB64u(event.public_key))) !== pending.commit) {
                incoming.delete(event.request_id);
                return;
            }
            pending.requester = event.public_key;
            const info = { requestId: event.request_id, name: pending.name, sas: await sasFor(event.request_id, event.public_key, pending.publicKey) };
            prompts.set(info.requestId, info);
            send({ type: "prompt", prompt: info });
            hooks.onPrompt({ ...info, approve: () => respond(info.requestId, "approve"), deny: () => respond(info.requestId, "deny") });
            return;
        }

        const offer = current?.revealed ? current.offers.get(event.device_id) : undefined;
        if (!current || !offer || current.approved) return;
        if (event.stage === "deny") {
            current.state = "denied";
            changed();
            return;
        }
        if (event.stage === "approve" && event.iv && event.ct) {
            try {
                const key = await channelKey(current.pair, offer.key, current.requestId);
                const secret = await aesDecrypt(key, fromB64u(event.iv), fromB64u(event.ct), channelAad(current.requestId, current.publicKey, offer.key));
                current.approved = true;
                current.error = null;
                await engine.unlockWithSecret(secret);
                current.state = "done";
                post({ request_id: current.requestId, stage: "cancel" }).catch(() => {});
            } catch (error) {
                console.error("[e2ee] approval didn't unlock this browser", error);
                current.state = "failed";
                current.error = errorText(error);
            }
            changed();
        }
    };

    const remoteRespond = (requestId: string, stage: "approve" | "deny") =>
        new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                responders.delete(requestId);
                reject(new Error("The other tab didn't answer"));
            }, 15000);
            responders.set(requestId, {
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            send({ type: "respond", requestId, stage });
        });

    const onTab = (message: TabMessage) => {
        if (stopped) return;
        if (message.type === "dismiss") {
            remotePrompts.delete(message.requestId);
            hooks.onDismiss(message.requestId);
            const responder = responders.get(message.requestId);
            responders.delete(message.requestId);
            if (message.error) responder?.reject(new Error(message.error));
            else responder?.resolve();
            return;
        }
        if (message.type === "unlocked") return hooks.onPeerUnlock();
        if (message.type === "reset") {
            forgetOutgoing();
            return hooks.onPeerReset();
        }
        if (!leader) {
            if (message.type === "outgoing") {
                remote = message.value;
                hooks.onChange();
            } else if (message.type === "prompt" && !remotePrompts.has(message.prompt.requestId)) {
                const { requestId } = message.prompt;
                remotePrompts.add(requestId);
                hooks.onPrompt({ ...message.prompt, approve: () => remoteRespond(requestId, "approve"), deny: () => remoteRespond(requestId, "deny") });
            }
            return;
        }
        if (message.type === "hello") {
            send({ type: "outgoing", value: snapshot() });
            prompts.forEach((prompt) => send({ type: "prompt", prompt }));
        } else if (message.type === "request")
            engine
                .refresh()
                .catch((error) => console.error("[e2ee] refresh failed", error))
                .then(() => (engine.linked ? send({ type: "unlocked" }) : request()))
                .catch((error) => console.error("[e2ee] link request failed", error));
        else if (message.type === "cancel") cancel();
        else if (message.type === "respond") respond(message.requestId, message.stage).catch((error) => console.error("[e2ee] link", error));
    };

    const becomeLeader = () => {
        if (stopped) return;
        leader = true;
        remotePrompts.forEach((id) => hooks.onDismiss(id));
        remotePrompts.clear();
        const inherited = remote;
        remote = null;
        if (engine.locked && (wanted || inherited?.state === "waiting" || inherited?.state === "comparing"))
            request().catch((error) => console.error("[e2ee] link request failed", error));
        changed();
    };

    const start = (userId: string) => {
        if (channel || leader || stopped) return;
        if (typeof BroadcastChannel === "function") {
            channel = new BroadcastChannel(`fosscord-e2ee-link:${userId}`);
            channel.addEventListener("message", (event: MessageEvent<TabMessage>) => onTab(event.data));
        }
        addEventListener("pagehide", () => {
            const current = outgoing;
            if (!leader || !current || current.approved || !engine.device || (current.state !== "waiting" && current.state !== "comparing")) return;
            hooks.beacon({ request_id: current.requestId, stage: "cancel", device_id: engine.device.deviceId });
        });
        if (!navigator.locks || !channel) return becomeLeader();
        navigator.locks.request(`fosscord-e2ee-link:${userId}`, () => {
            if (stopped) return;
            becomeLeader();
            return new Promise<void>((resolve) => {
                release = resolve;
            });
        });
        send({ type: "hello" });
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        leader = false;
        outgoing = null;
        remote = null;
        for (const id of [...prompts.keys(), ...remotePrompts]) hooks.onDismiss(id);
        prompts.clear();
        remotePrompts.clear();
        incoming.clear();
        channel?.close();
        channel = null;
        release?.();
        release = null;
        hooks.onChange();
    };

    const devicesChanged = () => {
        const current = outgoing;
        if (!leader || !current || current.state !== "comparing" || current.approved || !engine.locked) return;
        if ([...current.offers.keys()].some((id) => engine.devices.some((d) => d.device_id === id && d.status === "active"))) return;
        outgoing = null;
        changed();
        request().catch((error) => console.error("[e2ee] link request failed", error));
    };

    const invite = async (deviceId: string) => {
        if (!engine.device || !engine.linked) return;
        await post({ request_id: toB64u(randomBytes(16)), stage: "invite", to_device: deviceId });
    };

    return {
        start,
        stop,
        request,
        cancel,
        invite,
        devicesChanged,
        unlocked: () => send({ type: "unlocked" }),
        reset: () => {
            [...prompts.keys()].forEach((id) => dismiss(id));
            incoming.clear();
            forgetOutgoing();
            send({ type: "reset" });
        },
        onEvent: (type: string, event: LinkEvent) => {
            if (stopped) return;
            if (type === "E2EE_LINK_RESPONSE" && event.stage === "cancel") {
                incoming.delete(event.request_id);
                if (prompts.has(event.request_id)) dismiss(event.request_id);
                if (remotePrompts.delete(event.request_id)) hooks.onDismiss(event.request_id);
                return;
            }
            if (!leader) return;
            (type === "E2EE_LINK_REQUEST" ? onRequest(event) : onResponse(event)).catch((error) => console.error("[e2ee] link", error));
        },
        outgoing: (): Outgoing | null => (leader ? snapshot() : remote),
    };
};
