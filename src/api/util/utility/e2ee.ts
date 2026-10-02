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

import { createHash, createPublicKey, verify } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { In, IsNull, Not } from "typeorm";
import { Channel, E2eeDevice, E2eeIdentity, E2eeKeyBackup, Message, Recipient, Relationship } from "@spacebar/database";
import { ApiError, Config, emitEvent, MessageFlags } from "@spacebar/util";
import { ChannelType, E2eeEnvelope, E2eeUserKeysResponse, MessageType } from "@spacebar/schemas";
import { MessageOptions } from "@spacebar/util/dtos/MessageOptions";
import rateLimit from "../../middlewares/RateLimit";

export const E2EE_FALLBACK_CONTENT = "🔒 Encrypted message";
export const E2EE_ALGORITHM = "x25519-hpke-aes256gcm-ed25519";
export const E2EE_MAX_ENVELOPE_BYTES = 64 * 1024;
export const E2EE_MAX_DEVICES = 256;

export const E2eeErrors = {
    DEVICE_MISMATCH: new ApiError("E2EE_DEVICE_MISMATCH", 90001, 409),
    REQUIRED: new ApiError("E2EE_REQUIRED", 90002, 400),
    INVALID_ENVELOPE: new ApiError("E2EE_INVALID_ENVELOPE", 90003, 400),
    UNSUPPORTED: new ApiError("E2EE_UNSUPPORTED", 90004, 400),
    NOT_ENABLED: new ApiError("E2EE_NOT_ENABLED", 90005, 400),
    UNKNOWN_DEVICE: new ApiError("E2EE_UNKNOWN_DEVICE", 90006, 403),
    RECIPIENT_NO_DEVICES: new ApiError("E2EE_RECIPIENT_NO_DEVICES", 90007, 400),
    IDENTITY_EXISTS: new ApiError("E2EE_IDENTITY_EXISTS", 90008, 409),
    INVALID_SIGNATURE: new ApiError("E2EE_INVALID_SIGNATURE", 90009, 400),
    NO_IDENTITY: new ApiError("E2EE_NO_IDENTITY", 90010, 400),
    CANNOT_DISABLE: new ApiError("E2EE_CANNOT_DISABLE", 90011, 400),
    BACKUP_CONFLICT: new ApiError("E2EE_BACKUP_CONFLICT", 90012, 409),
    NO_BACKUP: new ApiError("E2EE_NO_BACKUP", 90013, 404),
    INVALID_BACKUP: new ApiError("E2EE_INVALID_BACKUP", 90014, 400),
    INVALID_LINK: new ApiError("E2EE_INVALID_LINK", 90015, 400),
};

export const e2eeRateLimit = (bucket: string, count: number, window: number) => {
    const limiter = rateLimit({ bucket, count, window });
    return (req: Request, res: Response, next: NextFunction) => (Config.get().limits.rate.enabled ? limiter(req, res, next) : next());
};

const b64url = /^[A-Za-z0-9_-]+$/;

export const decodeKey = (value: string, length: number) => {
    if (typeof value !== "string" || !b64url.test(value)) return null;
    const bytes = Buffer.from(value, "base64url");
    return bytes.length === length ? bytes : null;
};

export const e2eeDeviceId = (signingKey: string) => createHash("sha256").update(Buffer.from(signingKey, "base64url")).digest().subarray(0, 16).toString("base64url");

export const e2eeDeviceMessage = (userId: string, deviceId: string, signingKey: string) => `fosscord-e2ee/v1/device\n${userId}\n${deviceId}\n${signingKey}`;

export const e2eePrekeyMessage = (deviceId: string, prekeyId: number, publicKey: string) => `fosscord-e2ee/v1/prekey\n${deviceId}\n${prekeyId}\n${publicKey}`;

export const e2eeRotationMessage = (userId: string, previousKey: string, nextKey: string) => `fosscord-e2ee/v1/identity-rotate\n${userId}\n${previousKey}\n${nextKey}`;

export const e2eeBackupKeyMessage = (userId: string, publicKey: string) => `fosscord-e2ee/v1/backup-key\n${userId}\n${publicKey}`;

export async function e2eeUserKeys(ids: string[]) {
    const users: Record<string, E2eeUserKeysResponse> = {};
    if (!ids.length) return users;
    const [identities, backups, devices] = await Promise.all([
        E2eeIdentity.find({ where: { user_id: In(ids) } }),
        E2eeKeyBackup.find({ where: { user_id: In(ids) }, select: { user_id: true, identity_key: true, backup_public_key: true, backup_key_signature: true } }),
        E2eeDevice.find({ where: { user_id: In(ids) }, order: { created_at: "ASC" } }),
    ]);
    for (const id of ids) {
        const identity = identities.find((i) => i.user_id === id);
        const backup = backups.find((b) => b.user_id === id && b.identity_key === identity?.public_key);
        users[id] = {
            identity_key: identity?.public_key ?? null,
            previous_identity: identity?.previous_key && identity.rotation_signature ? { public_key: identity.previous_key, signature: identity.rotation_signature } : null,
            backup_key: backup ? { public_key: backup.backup_public_key, signature: backup.backup_key_signature } : null,
            devices: devices.filter((d) => d.user_id === id).map((d) => d.toPublic()),
        };
    }
    return users;
}

export const verifyEd25519 = (publicKey: string, message: string, signature: string) => {
    if (!decodeKey(publicKey, 32) || !decodeKey(signature, 64)) return false;
    try {
        const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
        return verify(null, Buffer.from(message), key, Buffer.from(signature, "base64url"));
    } catch {
        return false;
    }
};

export const isE2eeChannelType = (type: ChannelType) => type === ChannelType.DM || type === ChannelType.GROUP_DM;

export async function e2eeChannelIdsFor(userId: string) {
    const recipients = await Recipient.find({ where: { user_id: userId }, select: { channel_id: true } });
    if (!recipients.length) return [];
    const channels = await Channel.find({
        where: { id: In(recipients.map((r) => r.channel_id)), e2ee_enabled_at: Not(IsNull()) },
        select: { id: true },
    });
    return channels.map((c) => c.id);
}

export async function emitE2eeUserEvent(event: "E2EE_DEVICES_UPDATE" | "E2EE_IDENTITY_UPDATE", userId: string) {
    const mine = await Recipient.find({ where: { user_id: userId }, select: { channel_id: true } });
    const peers = mine.length ? await Recipient.find({ where: { channel_id: In(mine.map((r) => r.channel_id)) }, select: { user_id: true } }) : [];
    const data = { user_id: userId };
    await Promise.all([...new Set([userId, ...peers.map((r) => r.user_id)])].map((id) => emitEvent({ event, user_id: id, data })));
}

export async function sharesE2eeContext(userId: string, others: string[]) {
    const targets = others.filter((id) => id !== userId);
    if (!targets.length) return new Set<string>([userId]);
    const allowed = new Set<string>([userId]);
    const relationships = await Relationship.find({ where: { from_id: userId, to_id: In(targets) }, select: { to_id: true } });
    relationships.forEach((r) => allowed.add(r.to_id));
    const mine = await Recipient.find({ where: { user_id: userId }, select: { channel_id: true } });
    if (mine.length) {
        const shared = await Recipient.find({
            where: { channel_id: In(mine.map((r) => r.channel_id)), user_id: In(targets) },
            select: { user_id: true },
        });
        shared.forEach((r) => allowed.add(r.user_id));
    }
    return allowed;
}

const isEnvelope = (value: unknown): value is E2eeEnvelope => {
    if (!value || typeof value !== "object") return false;
    const env = value as E2eeEnvelope;
    if (env.v !== 1 || env.alg !== E2EE_ALGORITHM) return false;
    if (typeof env.sender_device !== "string" || !Array.isArray(env.keys) || !env.keys.length || env.keys.length > E2EE_MAX_DEVICES) return false;
    if (!decodeKey(env.iv, 12) || typeof env.ct !== "string" || !b64url.test(env.ct) || !decodeKey(env.sig, 64)) return false;
    if (env.mid !== undefined && (typeof env.mid !== "string" || !/^\d+$/.test(env.mid))) return false;
    if (env.backup !== undefined) {
        if (!Array.isArray(env.backup) || env.backup.length > E2EE_MAX_DEVICES) return false;
        const users = new Set<string>();
        const valid = env.backup.every((entry) => {
            if (!entry || typeof entry.user_id !== "string" || users.has(entry.user_id)) return false;
            users.add(entry.user_id);
            return !!decodeKey(entry.enc, 32) && typeof entry.wrapped === "string" && b64url.test(entry.wrapped);
        });
        if (!valid) return false;
    }
    const seen = new Set<string>();
    return env.keys.every((key) => {
        if (seen.has(key.device_id)) return false;
        seen.add(key.device_id);
        return (
            typeof key.user_id === "string" &&
            typeof key.device_id === "string" &&
            Number.isInteger(key.prekey_id) &&
            !!decodeKey(key.enc, 32) &&
            typeof key.wrapped === "string" &&
            b64url.test(key.wrapped)
        );
    });
};

export async function applyE2eeToMessage(opts: MessageOptions, channel: Channel, message: Message) {
    const envelope = opts.encrypted ?? null;
    const encryptedChannel = channel.e2ee_enabled_at != null;
    const userMessage = !!opts.author_id && !opts.webhook_id && !opts.application_id && [MessageType.DEFAULT, MessageType.REPLY].includes(opts.type ?? MessageType.DEFAULT);

    if (!envelope) {
        if (encryptedChannel && userMessage) throw E2eeErrors.REQUIRED;
        message.encrypted = null;
        return;
    }
    if (!encryptedChannel) throw E2eeErrors.NOT_ENABLED;
    if (!userMessage) throw E2eeErrors.UNSUPPORTED;
    if (Buffer.byteLength(JSON.stringify(envelope)) > E2EE_MAX_ENVELOPE_BYTES || !isEnvelope(envelope)) throw E2eeErrors.INVALID_ENVELOPE;

    const content = opts.content?.trim();
    if (content && content !== E2EE_FALLBACK_CONTENT) throw E2eeErrors.REQUIRED;
    if (opts.attachments?.length || opts.sticker_ids?.length || opts.poll || opts.components?.length || opts.tts || opts.message_reference?.type === 1)
        throw E2eeErrors.UNSUPPORTED;

    const editing = !!opts.edited_timestamp;
    if (envelope.mid !== undefined && (!editing || envelope.mid !== opts.id)) throw E2eeErrors.INVALID_ENVELOPE;

    if (!editing || envelope.mid !== undefined) {
        const sender = await E2eeDevice.findOne({ where: { id: envelope.sender_device, user_id: opts.author_id, status: "active" } });
        if (!sender) throw E2eeErrors.UNKNOWN_DEVICE;

        const memberIds = channel.recipients?.map((r) => r.user_id) ?? [];
        const active = memberIds.length ? await E2eeDevice.find({ where: { user_id: In(memberIds), status: "active" } }) : [];
        const required = new Map(active.map((d) => [d.id, d]));
        const given = new Map(envelope.keys.map((k) => [k.device_id, k]));
        const missing = active.some((d) => !given.has(d.id));
        const unknown = envelope.keys.some((k) => {
            const device = required.get(k.device_id);
            return !device || device.user_id !== k.user_id || device.prekey_id !== k.prekey_id;
        });
        if (missing || unknown) throw E2eeErrors.DEVICE_MISMATCH;
        if (envelope.backup?.some((b) => !memberIds.includes(b.user_id))) throw E2eeErrors.INVALID_ENVELOPE;
    }

    opts.content = E2EE_FALLBACK_CONTENT;
    opts.embeds = [];
    message.encrypted = envelope;
    message.content = E2EE_FALLBACK_CONTENT;
    message.embeds = [];
    message.flags = Number(BigInt(message.flags ?? 0) | MessageFlags.FLAGS.SUPPRESS_EMBEDS);
}
