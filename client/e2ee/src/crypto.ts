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

import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Bytes, fromB64u, sha256, toB64u, utf8 } from "./bytes";

export const ALGORITHM = "x25519-hpke-aes256gcm-ed25519";

const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

const subtle = () => crypto.subtle;

export const generateSigningKey = () => subtle().generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as Promise<CryptoKeyPair>;

export const generateAgreementKey = () => subtle().generateKey({ name: "X25519" }, false, ["deriveBits"]) as Promise<CryptoKeyPair>;

export const exportPublic = async (key: CryptoKey) => toB64u(await subtle().exportKey("raw", key));

export const sign = async (key: CryptoKey, message: string) => toB64u(await subtle().sign({ name: "Ed25519" }, key, utf8(message)));

export const verify = async (publicKey: string, message: string, signature: string) => {
    try {
        const raw = fromB64u(publicKey);
        const sig = fromB64u(signature);
        if (raw.length !== 32 || sig.length !== 64) return false;
        const key = await subtle().importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
        return await subtle().verify({ name: "Ed25519" }, key, sig, utf8(message));
    } catch {
        return false;
    }
};

export const deviceIdFor = async (signingKey: string) => toB64u((await sha256(fromB64u(signingKey))).subarray(0, 16));

export const hpkeSeal = async (recipientPublic: string, plaintext: Bytes, info: string, aad: string) => {
    const recipientPublicKey = await suite.kem.deserializePublicKey(fromB64u(recipientPublic));
    const { ct, enc } = await suite.seal({ recipientPublicKey, info: utf8(info) }, plaintext, utf8(aad));
    return { enc: toB64u(enc), wrapped: toB64u(ct) };
};

export const hpkeOpen = async (recipientKey: CryptoKeyPair, enc: string, wrapped: string, info: string, aad: string) =>
    new Uint8Array(await suite.open({ recipientKey, enc: fromB64u(enc), info: utf8(info) }, fromB64u(wrapped), utf8(aad)));

const aesKey = (raw: Bytes, usage: KeyUsage) => subtle().importKey("raw", raw, { name: "AES-GCM" }, false, [usage]);

export const aesEncrypt = async (raw: Bytes, iv: Bytes, plaintext: Bytes, aad: string) =>
    new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, await aesKey(raw, "encrypt"), plaintext));

export const aesDecrypt = async (raw: Bytes, iv: Bytes, ciphertext: Bytes, aad: string) =>
    new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, await aesKey(raw, "decrypt"), ciphertext));

export interface OkpJwk {
    kty: "OKP";
    crv: "Ed25519" | "X25519";
    x: string;
    d: string;
}

export const generateExportable = async (name: "Ed25519" | "X25519") => {
    const pair = (await subtle().generateKey({ name }, true, name === "Ed25519" ? ["sign", "verify"] : ["deriveBits"])) as CryptoKeyPair;
    const { kty, crv, x, d } = (await subtle().exportKey("jwk", pair.privateKey)) as OkpJwk;
    return { kty, crv, x, d } as OkpJwk;
};

export const importSigningJwk = (jwk: OkpJwk) => subtle().importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "Ed25519" }, false, ["sign"]);

export const importAgreementJwk = async (jwk: OkpJwk): Promise<CryptoKeyPair> => ({
    privateKey: await subtle().importKey("jwk", { ...jwk, key_ops: ["deriveBits"] }, { name: "X25519" }, false, ["deriveBits"]),
    publicKey: await subtle().importKey("raw", fromB64u(jwk.x), { name: "X25519" }, true, []),
});

export const x25519 = async (privateKey: CryptoKey, publicKey: string) => {
    const peer = await subtle().importKey("raw", fromB64u(publicKey), { name: "X25519" }, false, []);
    return new Uint8Array(await subtle().deriveBits({ name: "X25519", public: peer }, privateKey, 256));
};

export const hkdf = async (ikm: Bytes, salt: Bytes, info: string) => {
    const base = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: utf8(info) }, base, 256));
};

export const sealBox = async (key: Bytes, plaintext: Bytes, aad: string) => {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ct = await aesEncrypt(key, iv, plaintext, aad);
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return toB64u(out);
};

export const openBox = (key: Bytes, box: string, aad: string) => {
    const raw = fromB64u(box);
    if (raw.length < 28) throw new Error("box too short");
    return aesDecrypt(key, raw.slice(0, 12), raw.slice(12), aad);
};

export const rotationMessage = (userId: string, previousKey: string, nextKey: string) => `fosscord-e2ee/v1/identity-rotate\n${userId}\n${previousKey}\n${nextKey}`;

export const backupKeyMessage = (userId: string, publicKey: string) => `fosscord-e2ee/v1/backup-key\n${userId}\n${publicKey}`;

export const deviceMessage = (userId: string, deviceId: string, signingKey: string) => `fosscord-e2ee/v1/device\n${userId}\n${deviceId}\n${signingKey}`;

export const prekeyMessage = (deviceId: string, prekeyId: number, publicKey: string) => `fosscord-e2ee/v1/prekey\n${deviceId}\n${prekeyId}\n${publicKey}`;
