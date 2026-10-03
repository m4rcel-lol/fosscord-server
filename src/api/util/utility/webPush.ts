/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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

import crypto from "node:crypto";
import { Config, fetchPublicUrl } from "@spacebar/util";

export interface WebPushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
}

const RECORD_SIZE = 4096;
const TOKEN_LIFETIME = 12 * 60 * 60;
const tokens = new Map<string, { token: string; expires: number }>();

const pad32 = (value: Buffer) => (value.length >= 32 ? value.subarray(value.length - 32) : Buffer.concat([Buffer.alloc(32 - value.length), value]));

export function vapidPublicKey() {
    const { enabled, vapidPublicKey } = Config.get().security.webPush;
    return enabled ? vapidPublicKey : null;
}

function vapidSubject() {
    const { subject } = Config.get().security.webPush;
    if (subject) return subject;
    const endpoint = Config.get().api.endpointPublic ?? Config.get().general.serverName ?? "http://localhost";
    const host = URL.canParse(endpoint) ? new URL(endpoint).hostname : "localhost";
    return `mailto:push@${host}`;
}

function vapidToken(audience: string) {
    const now = Math.floor(Date.now() / 1000);
    const cached = tokens.get(audience);
    if (cached && cached.expires - 60 > now) return cached.token;

    const { vapidPublicKey, vapidPrivateKey } = Config.get().security.webPush;
    const publicKey = Buffer.from(vapidPublicKey, "base64url");
    const key = crypto.createPrivateKey({
        key: {
            kty: "EC",
            crv: "P-256",
            d: pad32(Buffer.from(vapidPrivateKey, "base64url")).toString("base64url"),
            x: publicKey.subarray(1, 33).toString("base64url"),
            y: publicKey.subarray(33, 65).toString("base64url"),
        },
        format: "jwk",
    });
    const expires = now + TOKEN_LIFETIME;
    const unsigned = `${Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ aud: audience, exp: expires, sub: vapidSubject() })).toString("base64url")}`;
    const signature = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
    const token = `${unsigned}.${signature.toString("base64url")}`;
    tokens.set(audience, { token, expires });
    return token;
}

export function encryptWebPushPayload(payload: Buffer, keys: WebPushSubscription["keys"]) {
    const clientPublicKey = Buffer.from(keys.p256dh, "base64url");
    const authSecret = Buffer.from(keys.auth, "base64url");
    const ecdh = crypto.createECDH("prime256v1");
    const serverPublicKey = ecdh.generateKeys();
    const sharedSecret = ecdh.computeSecret(clientPublicKey);
    const salt = crypto.randomBytes(16);

    const ikm = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), clientPublicKey, serverPublicKey]), 32));
    const contentKey = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

    const cipher = crypto.createCipheriv("aes-128-gcm", contentKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    const header = Buffer.alloc(21 + serverPublicKey.length);
    salt.copy(header, 0);
    header.writeUInt32BE(RECORD_SIZE, 16);
    header.writeUInt8(serverPublicKey.length, 20);
    serverPublicKey.copy(header, 21);
    return Buffer.concat([header, ciphertext]);
}

export async function sendWebPush(
    subscription: WebPushSubscription,
    payload: object,
    opts: { ttl?: number; topic?: string; urgency?: "very-low" | "low" | "normal" | "high" } = {},
) {
    const audience = new URL(subscription.endpoint).origin;
    const body = Buffer.from(JSON.stringify(payload));
    if (body.length > RECORD_SIZE - 17) throw new Error(`web push payload is ${body.length} bytes`);
    const res = await fetchPublicUrl(subscription.endpoint, {
        method: "POST",
        headers: {
            Authorization: `vapid t=${vapidToken(audience)}, k=${Config.get().security.webPush.vapidPublicKey}`,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: String(opts.ttl ?? 24 * 60 * 60),
            Urgency: opts.urgency ?? "high",
            ...(opts.topic && { Topic: opts.topic }),
        },
        body: encryptWebPushPayload(body, subscription.keys),
        signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, gone: res.status === 404 || res.status === 410 };
}
