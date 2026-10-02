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

import { argon2id } from "hash-wasm";
import { Bytes, fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from "./bytes";
import { hkdf, OkpJwk, openBox, sealBox } from "./crypto";

export type BackupMode = "password" | "recovery";

export interface BackupKdf {
    name: "argon2id" | "hkdf-sha256";
    memory?: number;
    iterations?: number;
    parallelism?: number;
}

export interface BackupSecretFields {
    version: number;
    mode: BackupMode;
    kdf: BackupKdf;
    salt: string;
    wrapped_secret: string | null;
}

export interface BackupRecord extends BackupSecretFields {
    identity_key: string;
    wrapped_identity: string;
    backup_public_key: string;
    backup_key_signature: string;
    wrapped_backup_key: string;
}

export const PASSWORD_KDF: BackupKdf = { name: "argon2id", memory: 65536, iterations: 3, parallelism: 1 };
export const RECOVERY_KDF: BackupKdf = { name: "hkdf-sha256" };

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 32;

export const generateRecoveryCode = () =>
    (
        [...randomBytes(CODE_LENGTH)]
            .map((byte) => ALPHABET[byte & 31])
            .join("")
            .match(/.{4}/g) ?? []
    ).join("-");

export const normalizeRecoveryCode = (code: string) =>
    code
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, "")
        .replace(/O/g, "0")
        .replace(/[IL]/g, "1");

export const isRecoveryCode = (code: string) => {
    const normalized = normalizeRecoveryCode(code);
    return normalized.length === CODE_LENGTH && [...normalized].every((c) => ALPHABET.includes(c));
};

const derived = new Map<string, Promise<Bytes>>();

export const deriveBackupKey = (kdf: BackupKdf, salt: string, input: string) => {
    const cacheKey = `${kdf.name}|${kdf.memory}|${kdf.iterations}|${salt}|${input}`;
    let pending = derived.get(cacheKey);
    if (!pending) {
        pending =
            kdf.name === "argon2id"
                ? argon2id({
                      password: utf8(input),
                      salt: fromB64u(salt),
                      parallelism: kdf.parallelism ?? 1,
                      iterations: kdf.iterations ?? 3,
                      memorySize: kdf.memory ?? 65536,
                      hashLength: 32,
                      outputType: "binary",
                  }).then((bytes) => new Uint8Array(bytes))
                : hkdf(utf8(normalizeRecoveryCode(input)), fromB64u(salt), "fosscord-e2ee/v1/recovery-code");
        pending.catch(() => derived.delete(cacheKey));
        derived.clear();
        derived.set(cacheKey, pending);
    }
    return pending;
};

const secretAad = (userId: string) => `fosscord-e2ee/v1/backup-secret\n${userId}`;

export const wrapSecret = async (userId: string, mode: BackupMode, input: string, secret: Bytes) => {
    const kdf = mode === "password" ? PASSWORD_KDF : RECOVERY_KDF;
    const salt = toB64u(randomBytes(16));
    const key = await deriveBackupKey(kdf, salt, input);
    return { mode, kdf, salt, wrapped_secret: await sealBox(key, secret, secretAad(userId)) };
};

export const unwrapSecret = async (userId: string, record: BackupSecretFields, input: string) => {
    if (!record.wrapped_secret) throw new Error("backup has no wrapped secret");
    const key = await deriveBackupKey(record.kdf, record.salt, input);
    return openBox(key, record.wrapped_secret, secretAad(userId));
};

const secretKey = (secret: Bytes, label: string) => hkdf(secret, new Uint8Array(32), `fosscord-e2ee/v1/backup/${label}`);

export const sealJwk = async (secret: Bytes, label: string, userId: string, jwk: OkpJwk) =>
    sealBox(await secretKey(secret, label), utf8(JSON.stringify(jwk)), `${label}\n${userId}`);

export const openJwk = async (secret: Bytes, label: string, userId: string, box: string) => {
    const jwk = JSON.parse(fromUtf8(await openBox(await secretKey(secret, label), box, `${label}\n${userId}`))) as OkpJwk;
    if (jwk.kty !== "OKP" || typeof jwk.x !== "string" || typeof jwk.d !== "string") throw new Error("bad key in backup");
    return jwk;
};
