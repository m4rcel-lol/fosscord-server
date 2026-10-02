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

import { fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from "./bytes";
import {
    aesDecrypt,
    aesEncrypt,
    ALGORITHM,
    deviceIdFor,
    deviceMessage,
    exportPublic,
    generateAgreementKey,
    generateSigningKey,
    hpkeOpen,
    hpkeSeal,
    prekeyMessage,
    sign,
    verify,
} from "./crypto";
import { Contact, scoped, Store, StoredDevice, StoredIdentity, StoredPrekey } from "./store";

export const FALLBACK_CONTENT = "🔒 Encrypted message";
const WRAP_INFO = "fosscord-e2ee/v1/wrap";
const PREKEY_ROTATE_MS = 7 * 24 * 3600 * 1000;
const PREKEY_KEEP_MS = 30 * 24 * 3600 * 1000;
const DIRECTORY_TTL_MS = 5 * 60 * 1000;

export interface EnvelopeKey {
    user_id: string;
    device_id: string;
    prekey_id: number;
    enc: string;
    wrapped: string;
}

export interface Envelope {
    v: number;
    alg: string;
    sender_device: string;
    mid?: string;
    iv: string;
    ct: string;
    keys: EnvelopeKey[];
    sig: string;
}

export interface RawMessage {
    id: string;
    channel_id: string;
    content?: string;
    nonce?: string | number | null;
    author?: { id: string };
    encrypted?: Envelope | null;
}

interface ServerDevice {
    device_id: string;
    signing_key: string;
    identity_signature: string | null;
    status: "active" | "pending" | "revoked";
    name: string | null;
    prekey: { id: number; public_key: string; signature: string };
}

interface ServerUserKeys {
    identity_key: string | null;
    devices: ServerDevice[];
}

export interface DirectoryDevice {
    deviceId: string;
    signingKey: string;
    status: ServerDevice["status"];
    name: string | null;
    prekeyId: number;
    prekeyPublic: string;
}

export interface DirectoryEntry {
    userId: string;
    identityKey: string | null;
    identityChanged: boolean;
    devices: DirectoryDevice[];
    fetchedAt: number;
}

export interface ChannelMember {
    id: string;
    username: string;
    global_name?: string | null;
}

export interface Api {
    request<T>(method: "get" | "post" | "put" | "patch" | "del", url: string, body?: unknown): Promise<T>;
}

export class E2eeError extends Error {
    constructor(
        readonly code: "NOT_READY" | "NOT_LINKED" | "IDENTITY_CHANGED" | "NO_DEVICES" | "UNSUPPORTED" | "BAD_ENVELOPE" | "NO_KEY" | "BAD_SIGNATURE",
        message: string,
        readonly userId?: string,
    ) {
        super(message);
    }
}

const binding = (mid: string | undefined, nonce: string | undefined) => (mid ? `m:${mid}` : `n:${nonce ?? ""}`);

const messageAad = (channelId: string, senderId: string, senderDevice: string, bind: string) => `fosscord-e2ee/v1/msg\n${channelId}\n${senderId}\n${senderDevice}\n${bind}`;

const signedPayload = (channelId: string, senderId: string, bind: string, env: Omit<Envelope, "sig">) =>
    JSON.stringify([
        "fosscord-e2ee/v1/sig",
        channelId,
        senderId,
        bind,
        env.v,
        env.alg,
        env.sender_device,
        env.mid ?? null,
        env.iv,
        env.ct,
        [...env.keys].sort((a, b) => (a.device_id < b.device_id ? -1 : 1)).map((k) => [k.user_id, k.device_id, k.prekey_id, k.enc, k.wrapped]),
    ]);

export class Engine {
    userId = "";
    linked = false;
    deviceStatus: ServerDevice["status"] | "unregistered" = "unregistered";
    identity: StoredIdentity | null = null;
    device: StoredDevice | null = null;
    prekeys: StoredPrekey[] = [];
    contacts: Record<string, Contact> = {};
    encryptedChannels = new Set<string>();
    private store: Store | null = null;
    private directory = new Map<string, Promise<DirectoryEntry>>();
    private members = new Map<string, Promise<string[]>>();
    private profiles = new Map<string, Promise<ChannelMember>>();
    private plaintext = new Map<string, string>();
    private listeners = new Set<() => void>();

    constructor(private api: Api) {}

    onChange(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit() {
        this.listeners.forEach((listener) => listener());
    }

    async init(userId: string) {
        this.userId = userId;
        this.store = scoped(userId);
        this.contacts = (await this.store.get<Record<string, Contact>>("contacts")) ?? {};
        await this.ensureKeys();
        this.emit();
    }

    private async saveContacts() {
        await this.store!.set("contacts", this.contacts);
    }

    private async newPrekey(id: number) {
        const keyPair = await generateAgreementKey();
        const publicKey = await exportPublic(keyPair.publicKey);
        const signature = await sign(this.device!.privateKey, prekeyMessage(this.device!.deviceId, id, publicKey));
        return { id, publicKey, signature, keyPair, createdAt: Date.now(), retiredAt: null } satisfies StoredPrekey;
    }

    private currentPrekey() {
        return this.prekeys.reduce((a, b) => (b.id > a.id ? b : a));
    }

    private async ensureKeys() {
        const store = this.store!;
        const state = await this.api.request<{ identity_key: string | null; devices: ServerDevice[]; channels: string[] }>("get", "/users/@me/e2ee");
        this.encryptedChannels = new Set(state.channels);
        this.identity = (await store.get<StoredIdentity>("identity")) ?? null;
        this.device = (await store.get<StoredDevice>("device")) ?? null;
        this.prekeys = (await store.get<StoredPrekey[]>("prekeys")) ?? [];

        if (!this.identity && !state.identity_key) {
            const pair = await generateSigningKey();
            this.identity = { publicKey: await exportPublic(pair.publicKey), privateKey: pair.privateKey };
            await store.set("identity", this.identity);
        }
        if (this.identity && !state.identity_key) await this.api.request("put", "/users/@me/e2ee/identity", { public_key: this.identity.publicKey });
        const identityMatches = !!this.identity && (!state.identity_key || state.identity_key === this.identity.publicKey);

        let serverDevice = this.device ? state.devices.find((d) => d.device_id === this.device!.deviceId) : undefined;
        if (!this.device || serverDevice?.status === "revoked") {
            const pair = await generateSigningKey();
            const signingKey = await exportPublic(pair.publicKey);
            this.device = { deviceId: await deviceIdFor(signingKey), signingKey, privateKey: pair.privateKey };
            this.prekeys = [];
            serverDevice = undefined;
            await store.set("device", this.device);
        }
        if (!this.prekeys.length) {
            this.prekeys = [await this.newPrekey(1)];
            await store.set("prekeys", this.prekeys);
        }

        let current = this.currentPrekey();
        if (serverDevice && Date.now() - current.createdAt > PREKEY_ROTATE_MS) {
            const next = await this.newPrekey(current.id + 1);
            current.retiredAt = Date.now();
            this.prekeys = [...this.prekeys.filter((p) => !p.retiredAt || Date.now() - p.retiredAt < PREKEY_KEEP_MS), next];
            await store.set("prekeys", this.prekeys);
            await this.api.request("put", `/users/@me/e2ee/devices/${this.device.deviceId}/prekey`, { id: next.id, public_key: next.publicKey, signature: next.signature });
            serverDevice.prekey = { id: next.id, public_key: next.publicKey, signature: next.signature };
            current = next;
        }

        const needsSignature = identityMatches && serverDevice?.status !== "active";
        if (!serverDevice || serverDevice.prekey.id !== current.id || needsSignature) {
            const identitySignature = identityMatches ? await sign(this.identity!.privateKey, deviceMessage(this.userId, this.device.deviceId, this.device.signingKey)) : undefined;
            serverDevice = await this.api.request<ServerDevice>("post", "/users/@me/e2ee/devices", {
                device_id: this.device.deviceId,
                signing_key: this.device.signingKey,
                identity_signature: identitySignature,
                name: navigator.userAgent.slice(0, 64),
                prekey: { id: current.id, public_key: current.publicKey, signature: current.signature },
            });
        }
        this.deviceStatus = serverDevice.status;
        this.linked = identityMatches && serverDevice.status === "active";
        this.directory.delete(this.userId);
    }

    invalidateUser(userId: string) {
        this.directory.delete(userId);
    }

    invalidateChannel(channelId: string) {
        this.members.delete(channelId);
    }

    invalidateAll() {
        this.directory.clear();
        this.members.clear();
    }

    setChannelEncrypted(channelId: string) {
        this.encryptedChannels.add(channelId);
        this.emit();
    }

    isEncrypted(channelId: string) {
        return this.encryptedChannels.has(channelId);
    }

    channelMembers(channelId: string) {
        let pending = this.members.get(channelId);
        if (!pending) {
            pending = this.api.request<{ users: Record<string, ServerUserKeys>; channel_members?: string[] }>("post", "/e2ee/keys/query", { channel_id: channelId }).then((res) => {
                const ids = res.channel_members ?? [];
                for (const id of ids) {
                    const entry = this.verifyEntry(id, res.users[id] ?? { identity_key: null, devices: [] });
                    entry.catch(() => this.directory.delete(id));
                    this.directory.set(id, entry);
                }
                return ids.filter((id) => id !== this.userId);
            });
            pending.catch(() => this.members.delete(channelId));
            this.members.set(channelId, pending);
        }
        return pending;
    }

    profile(userId: string) {
        let pending = this.profiles.get(userId);
        if (!pending) {
            pending = this.api.request<ChannelMember>("get", `/users/${userId}`).catch(() => ({ id: userId, username: userId }));
            this.profiles.set(userId, pending);
        }
        return pending;
    }

    async keysFor(userIds: string[], force = false): Promise<DirectoryEntry[]> {
        const missing = [...new Set(userIds)].filter((id) => force || !this.directory.has(id));
        if (missing.length) {
            const batch = this.api.request<{ users: Record<string, ServerUserKeys> }>("post", "/e2ee/keys/query", { user_ids: missing });
            for (const id of missing) {
                const entry = batch.then((res) => this.verifyEntry(id, res.users[id] ?? { identity_key: null, devices: [] }));
                entry.catch(() => this.directory.delete(id));
                this.directory.set(id, entry);
            }
        }
        const entries = await Promise.all(userIds.map((id) => this.directory.get(id)!));
        const stale = entries.filter((e) => Date.now() - e.fetchedAt > DIRECTORY_TTL_MS).map((e) => e.userId);
        return stale.length && !force ? this.keysFor(userIds, true) : entries;
    }

    private async verifyEntry(userId: string, keys: ServerUserKeys): Promise<DirectoryEntry> {
        const identityKey = keys.identity_key;
        let identityChanged = false;
        if (identityKey && userId === this.userId) identityChanged = identityKey !== this.identity?.publicKey;
        else if (identityKey) {
            const contact = this.contacts[userId];
            if (!contact) {
                this.contacts[userId] = { identityKey, verified: false, pendingKey: null, firstSeen: Date.now() };
                await this.saveContacts();
            } else if (contact.identityKey !== identityKey) {
                if (contact.pendingKey !== identityKey) {
                    contact.pendingKey = identityKey;
                    contact.verified = false;
                    await this.saveContacts();
                    queueMicrotask(() => this.emit());
                }
                identityChanged = true;
            }
        }
        const devices: DirectoryDevice[] = [];
        if (identityKey) {
            for (const device of keys.devices) {
                if (!device.identity_signature) continue;
                if ((await deviceIdFor(device.signing_key)) !== device.device_id) continue;
                if (!(await verify(identityKey, deviceMessage(userId, device.device_id, device.signing_key), device.identity_signature))) continue;
                if (!(await verify(device.signing_key, prekeyMessage(device.device_id, device.prekey.id, device.prekey.public_key), device.prekey.signature))) continue;
                devices.push({
                    deviceId: device.device_id,
                    signingKey: device.signing_key,
                    status: device.status,
                    name: device.name,
                    prekeyId: device.prekey.id,
                    prekeyPublic: device.prekey.public_key,
                });
            }
        }
        return { userId, identityKey, identityChanged, devices, fetchedAt: Date.now() };
    }

    async acceptIdentity(userId: string) {
        const contact = this.contacts[userId];
        if (!contact?.pendingKey) return;
        contact.identityKey = contact.pendingKey;
        contact.pendingKey = null;
        contact.verified = false;
        await this.saveContacts();
        this.directory.delete(userId);
        this.emit();
    }

    async setVerified(userId: string, verified: boolean) {
        const contact = this.contacts[userId];
        if (!contact) return;
        contact.verified = verified;
        await this.saveContacts();
        this.emit();
    }

    async encrypt(channelId: string, content: string, opts: { nonce?: string; mid?: string }): Promise<Envelope> {
        if (!this.device || !this.userId) throw new E2eeError("NOT_READY", "Encryption is still starting up");
        if (!this.linked) throw new E2eeError("NOT_LINKED", "This browser is not linked to your encryption identity");
        const members = [this.userId, ...(await this.channelMembers(channelId))];
        const entries = await this.keysFor(members);
        const targets: { userId: string; device: DirectoryDevice }[] = [];
        for (const entry of entries) {
            if (entry.identityChanged) throw new E2eeError("IDENTITY_CHANGED", "A safety number changed", entry.userId);
            const active = entry.devices.filter((d) => d.status === "active");
            if (!active.length) throw new E2eeError("NO_DEVICES", "A member has no encryption keys yet", entry.userId);
            active.forEach((device) => targets.push({ userId: entry.userId, device }));
        }
        if (!targets.some((t) => t.device.deviceId === this.device!.deviceId)) {
            const current = this.currentPrekey();
            targets.push({
                userId: this.userId,
                device: { deviceId: this.device.deviceId, signingKey: this.device.signingKey, status: "active", name: null, prekeyId: current.id, prekeyPublic: current.publicKey },
            });
        }

        const bind = binding(opts.mid, opts.nonce);
        const aad = messageAad(channelId, this.userId, this.device.deviceId, bind);
        const contentKey = randomBytes(32);
        const iv = randomBytes(12);
        const ct = await aesEncrypt(contentKey, iv, utf8(JSON.stringify({ content })), aad);
        const keys = await Promise.all(
            targets.map(async ({ userId, device }) => ({
                user_id: userId,
                device_id: device.deviceId,
                prekey_id: device.prekeyId,
                ...(await hpkeSeal(device.prekeyPublic, contentKey, WRAP_INFO, `${aad}\n${device.deviceId}`)),
            })),
        );
        const unsigned = { v: 1, alg: ALGORITHM, sender_device: this.device.deviceId, ...(opts.mid ? { mid: opts.mid } : {}), iv: toB64u(iv), ct: toB64u(ct), keys };
        const sig = await sign(this.device.privateKey, signedPayload(channelId, this.userId, bind, unsigned));
        const envelope = { ...unsigned, sig };
        this.plaintext.set(`${opts.mid ?? ""}:${sig}`, content);
        return envelope;
    }

    cached(message: RawMessage) {
        const env = message.encrypted;
        return env ? (this.plaintext.get(`${message.id}:${env.sig}`) ?? this.plaintext.get(`${env.mid ?? ""}:${env.sig}`)) : undefined;
    }

    async decrypt(message: RawMessage): Promise<string> {
        const env = message.encrypted;
        if (!env || env.v !== 1 || env.alg !== ALGORITHM || !Array.isArray(env.keys)) throw new E2eeError("BAD_ENVELOPE", "Unsupported envelope");
        const hit = this.cached(message);
        if (hit !== undefined) {
            this.plaintext.set(`${message.id}:${env.sig}`, hit);
            return hit;
        }
        if (!this.device) throw new E2eeError("NOT_READY", "Encryption is still starting up");
        const senderId = message.author?.id;
        if (!senderId) throw new E2eeError("BAD_ENVELOPE", "Missing author");
        if (env.mid && env.mid !== message.id) throw new E2eeError("BAD_ENVELOPE", "Envelope belongs to another message");
        const nonce = message.nonce == null ? undefined : String(message.nonce);
        if (!env.mid && !nonce) throw new E2eeError("BAD_ENVELOPE", "Missing nonce");

        let [entry] = await this.keysFor([senderId]);
        let sender = entry.devices.find((d) => d.deviceId === env.sender_device);
        if (!sender) {
            [entry] = await this.keysFor([senderId], true);
            sender = entry.devices.find((d) => d.deviceId === env.sender_device);
        }
        if (!sender) throw new E2eeError("BAD_SIGNATURE", "Unknown sender device");
        const bind = binding(env.mid, nonce);
        const { sig, ...unsigned } = env;
        if (!(await verify(sender.signingKey, signedPayload(message.channel_id, senderId, bind, unsigned), sig))) throw new E2eeError("BAD_SIGNATURE", "Signature check failed");

        const mine = env.keys.find((k) => k.device_id === this.device!.deviceId);
        if (!mine) throw new E2eeError("NO_KEY", "This message was not encrypted for this browser");
        const prekey = this.prekeys.find((p) => p.id === mine.prekey_id);
        if (!prekey) throw new E2eeError("NO_KEY", "The key for this message has expired");
        const aad = messageAad(message.channel_id, senderId, env.sender_device, bind);
        const contentKey = await hpkeOpen(prekey.keyPair, mine.enc, mine.wrapped, WRAP_INFO, `${aad}\n${mine.device_id}`);
        const payload = JSON.parse(fromUtf8(await aesDecrypt(contentKey, fromB64u(env.iv), fromB64u(env.ct), aad))) as { content?: unknown };
        const content = typeof payload.content === "string" ? payload.content : "";
        this.plaintext.set(`${message.id}:${env.sig}`, content);
        return content;
    }

    async safetyNumber(userId: string) {
        const [entry] = await this.keysFor([userId]);
        const theirs = this.contacts[userId]?.pendingKey ?? entry.identityKey;
        if (!theirs || !this.identity) return null;
        const part = async (id: string, key: string) => {
            let digest = new Uint8Array(await crypto.subtle.digest("SHA-512", new Uint8Array([0, 0, ...fromB64u(key), ...utf8(id)])));
            for (let i = 0; i < 5200; i++) digest = new Uint8Array(await crypto.subtle.digest("SHA-512", new Uint8Array([...digest, ...fromB64u(key)])));
            let out = "";
            for (let i = 0; i < 30; i += 5) {
                const chunk = digest.subarray(i, i + 5).reduce((acc, byte) => acc * 256 + byte, 0);
                out += String(chunk % 100000).padStart(5, "0");
            }
            return out;
        };
        const [mine, other] = await Promise.all([part(this.userId, this.identity.publicKey), part(userId, theirs)]);
        return mine < other ? mine + other : other + mine;
    }
}
