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

interface OutgoingInternal extends Outgoing {
    pair: CryptoKeyPair;
    publicKey: string;
    approver: string | null;
    approverKey: string | null;
}

interface IncomingInternal {
    deviceId: string;
    name: string;
    commit: string;
    pair: CryptoKeyPair;
    publicKey: string;
}

const sasFor = async (requestId: string, requester: string, approver: string) => {
    const digest = await sha256(utf8(`fosscord-e2ee/v1/sas\n${requestId}\n${requester}\n${approver}`));
    const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
    const digits = String(value % 1000000).padStart(6, "0");
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
};

const channelKey = async (pair: CryptoKeyPair, peer: string, requestId: string) => hkdf(await x25519(pair.privateKey, peer), utf8(requestId), "fosscord-e2ee/v1/link");

const channelAad = (requestId: string, requester: string, approver: string) => `fosscord-e2ee/v1/link\n${requestId}\n${requester}\n${approver}`;

export const createLink = (engine: Engine, api: Api, hooks: { onPrompt: (prompt: Incoming) => void; onChange: () => void; onDismiss: (requestId: string) => void }) => {
    let outgoing: OutgoingInternal | null = null;
    const incoming = new Map<string, IncomingInternal>();

    const post = (body: Record<string, unknown>) => api.request("post", "/users/@me/e2ee/link", { ...body, device_id: engine.device!.deviceId });

    const request = async () => {
        if (!engine.device || engine.linked) return;
        const pair = await generateAgreementKey();
        const publicKey = await exportPublic(pair.publicKey);
        outgoing = { requestId: toB64u(randomBytes(16)), state: "waiting", sas: null, approverName: null, pair, publicKey, approver: null, approverKey: null };
        hooks.onChange();
        await post({ request_id: outgoing.requestId, stage: "request", name: deviceName(), commit: toB64u(await sha256(fromB64u(publicKey))) });
    };

    const cancel = async () => {
        const current = outgoing;
        outgoing = null;
        hooks.onChange();
        if (current && current.state !== "done") await post({ request_id: current.requestId, stage: "cancel" }).catch(() => {});
    };

    const onRequest = async (event: LinkEvent) => {
        if (!engine.device || event.device_id === engine.device.deviceId || !engine.linked || !engine.exportSecret() || !event.commit) return;
        if (incoming.has(event.request_id) || incoming.size > 8) return;
        const pair = await generateAgreementKey();
        const publicKey = await exportPublic(pair.publicKey);
        incoming.set(event.request_id, { deviceId: event.device_id, name: event.name ?? "a new browser", commit: event.commit, pair, publicKey });
        setTimeout(() => incoming.delete(event.request_id), 10 * 60 * 1000);
        await post({ request_id: event.request_id, stage: "offer", to_device: event.device_id, public_key: publicKey });
    };

    const onResponse = async (event: LinkEvent) => {
        const mine = engine.device?.deviceId;
        if (event.stage === "cancel") {
            if (incoming.delete(event.request_id)) hooks.onDismiss(event.request_id);
            return;
        }
        if (!mine || event.to_device !== mine) return;
        const current = outgoing?.requestId === event.request_id ? outgoing : null;

        if (event.stage === "offer" && current && !current.approver && event.public_key) {
            current.approver = event.device_id;
            current.approverKey = event.public_key;
            current.approverName = engine.devices.find((d) => d.device_id === event.device_id)?.name ?? null;
            current.sas = await sasFor(current.requestId, current.publicKey, event.public_key);
            current.state = "comparing";
            hooks.onChange();
            await post({ request_id: current.requestId, stage: "reveal", to_device: event.device_id, public_key: current.publicKey });
            return;
        }

        if (event.stage === "reveal" && event.public_key) {
            const pending = incoming.get(event.request_id);
            if (!pending || pending.deviceId !== event.device_id) return;
            if (toB64u(await sha256(fromB64u(event.public_key))) !== pending.commit) {
                incoming.delete(event.request_id);
                return;
            }
            const requester = event.public_key;
            const sas = await sasFor(event.request_id, requester, pending.publicKey);
            const respond = async (stage: "approve" | "deny") => {
                if (!incoming.delete(event.request_id)) return;
                if (stage === "deny") return void (await post({ request_id: event.request_id, stage, to_device: pending.deviceId }));
                const secret = engine.exportSecret();
                if (!secret) throw new Error("This browser can't approve logins");
                const key = await channelKey(pending.pair, requester, event.request_id);
                const iv = randomBytes(12);
                const ct = await aesEncrypt(key, iv, secret, channelAad(event.request_id, requester, pending.publicKey));
                await post({ request_id: event.request_id, stage, to_device: pending.deviceId, iv: toB64u(iv), ct: toB64u(ct) });
            };
            hooks.onPrompt({ requestId: event.request_id, name: pending.name, sas, approve: () => respond("approve"), deny: () => respond("deny") });
            return;
        }

        if (!current || event.device_id !== current.approver) return;
        if (event.stage === "deny") {
            current.state = "denied";
            hooks.onChange();
            return;
        }
        if (event.stage === "approve" && event.iv && event.ct && current.approverKey) {
            try {
                const key = await channelKey(current.pair, current.approverKey, current.requestId);
                const secret = await aesDecrypt(key, fromB64u(event.iv), fromB64u(event.ct), channelAad(current.requestId, current.publicKey, current.approverKey));
                await engine.unlockWithSecret(secret);
                current.state = "done";
            } catch (error) {
                console.error("[e2ee] approval didn't unlock this browser", error);
                current.state = "failed";
            }
            hooks.onChange();
        }
    };

    return {
        request,
        cancel,
        onEvent: (type: string, event: LinkEvent) => (type === "E2EE_LINK_REQUEST" ? onRequest(event) : onResponse(event)).catch((error) => console.error("[e2ee] link", error)),
        outgoing: (): Outgoing | null => (outgoing ? { requestId: outgoing.requestId, state: outgoing.state, sas: outgoing.sas, approverName: outgoing.approverName } : null),
    };
};
