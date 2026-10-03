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
import { Api, deviceName, Engine } from "./engine";
import { t } from "./i18n";

export interface LinkEvent {
    request_id: string;
    stage: "request" | "offer" | "reveal" | "approve" | "deny" | "cancel";
    device_id: string;
    to_device: string | null;
    name: string | null;
    commit: string | null;
    public_key: string | null;
    iv: string | null;
    ct: string | null;
}

export type OutgoingState = "waiting" | "comparing" | "denied" | "failed" | "done";

export interface Outgoing {
    requestId: string;
    state: OutgoingState;
    sas: string | null;
    approverName: string | null;
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
    | { type: "outgoing"; value: Outgoing | null }
    | { type: "prompt"; prompt: PromptInfo }
    | { type: "respond"; requestId: string; stage: "approve" | "deny" }
    | { type: "dismiss"; requestId: string; error?: string };

interface OutgoingInternal extends Outgoing {
    pair: CryptoKeyPair;
    publicKey: string;
    approver: string | null;
    approverKey: string | null;
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
    beacon: (body: Record<string, unknown>) => void;
}

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
    let channel: BroadcastChannel | null = null;
    const incoming = new Map<string, IncomingInternal>();
    const prompts = new Map<string, PromptInfo>();
    const remotePrompts = new Set<string>();
    const responders = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

    const send = (message: TabMessage) => channel?.postMessage(message);

    const snapshot = (): Outgoing | null => (outgoing ? { requestId: outgoing.requestId, state: outgoing.state, sas: outgoing.sas, approverName: outgoing.approverName } : null);

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
        if (!engine.device || engine.linked) return;
        const current: OutgoingInternal = {
            requestId: toB64u(randomBytes(16)),
            state: "waiting",
            sas: null,
            approverName: null,
            pair,
            publicKey,
            approver: null,
            approverKey: null,
            approved: false,
        };
        outgoing = current;
        changed();
        const body = { request_id: current.requestId, stage: "request", name: deviceName(), commit: toB64u(await sha256(fromB64u(publicKey))) };
        await post(body);
        let attempts = 0;
        const timer = setInterval(() => {
            if (outgoing !== current || current.state !== "waiting" || engine.linked || ++attempts > 30) return clearInterval(timer);
            post(body).catch(() => {});
        }, 10000);
    };

    const request = () => {
        wanted = true;
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
                if (!secret) throw new Error(t("This browser can't approve logins"));
                const key = await channelKey(pending.pair, requester, requestId);
                const iv = randomBytes(12);
                const ct = await aesEncrypt(key, iv, secret, channelAad(requestId, requester, pending.publicKey));
                await post({ request_id: requestId, stage, to_device: pending.deviceId, iv: toB64u(iv), ct: toB64u(ct) });
            }
            dismiss(requestId);
        } catch (error) {
            dismiss(requestId, error instanceof Error ? error.message : String(error));
            throw error;
        }
    };

    const onResponse = async (event: LinkEvent) => {
        const mine = engine.device?.deviceId;
        if (!mine || event.to_device !== mine) return;
        const current = outgoing?.requestId === event.request_id ? outgoing : null;

        if (event.stage === "offer" && current && !current.approver && event.public_key) {
            current.approver = event.device_id;
            current.approverKey = event.public_key;
            current.approverName = engine.devices.find((d) => d.device_id === event.device_id)?.name ?? null;
            current.sas = await sasFor(current.requestId, current.publicKey, event.public_key);
            current.state = "comparing";
            changed();
            await post({ request_id: current.requestId, stage: "reveal", to_device: event.device_id, public_key: current.publicKey });
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

        if (!current || event.device_id !== current.approver) return;
        if (event.stage === "deny") {
            current.state = "denied";
            changed();
            return;
        }
        if (event.stage === "approve" && event.iv && event.ct && current.approverKey) {
            try {
                const key = await channelKey(current.pair, current.approverKey, current.requestId);
                const secret = await aesDecrypt(key, fromB64u(event.iv), fromB64u(event.ct), channelAad(current.requestId, current.publicKey, current.approverKey));
                current.approved = true;
                await engine.unlockWithSecret(secret);
                current.state = "done";
            } catch (error) {
                console.error("[e2ee] approval didn't unlock this browser", error);
                current.state = "failed";
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
        } else if (message.type === "request") request().catch((error) => console.error("[e2ee] link request failed", error));
        else if (message.type === "cancel") cancel();
        else if (message.type === "respond") respond(message.requestId, message.stage).catch((error) => console.error("[e2ee] link", error));
    };

    const becomeLeader = () => {
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
        if (channel || leader) return;
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
            becomeLeader();
            return new Promise<void>(() => {});
        });
        send({ type: "hello" });
    };

    return {
        start,
        request,
        cancel,
        unlocked: () => send({ type: "unlocked" }),
        onEvent: (type: string, event: LinkEvent) => {
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
