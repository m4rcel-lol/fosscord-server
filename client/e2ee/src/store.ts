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

export interface StoredIdentity {
    publicKey: string;
    privateKey: CryptoKey;
}

export interface StoredDevice {
    deviceId: string;
    signingKey: string;
    privateKey: CryptoKey;
}

export interface StoredPrekey {
    id: number;
    publicKey: string;
    signature: string;
    keyPair: CryptoKeyPair;
    createdAt: number;
    retiredAt: number | null;
}

export interface Contact {
    identityKey: string;
    verified: boolean;
    pendingKey: string | null;
    firstSeen: number;
    previousKeys?: string[];
}

let database: Promise<IDBDatabase> | null = null;

const open = () =>
    (database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open("fosscord-e2ee", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("kv");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));

const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction("kv", mode);
        const request = action(tx.objectStore("kv"));
        tx.oncomplete = () => resolve(request.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

export const scoped = (userId: string) => {
    const key = (name: string) => `${userId}:${name}`;
    return {
        get: <T>(name: string) => run<T | undefined>("readonly", (s) => s.get(key(name))),
        set: <T>(name: string, value: T) => run<IDBValidKey>("readwrite", (s) => s.put(value, key(name))),
        del: (name: string) => run<undefined>("readwrite", (s) => s.delete(key(name))),
    };
};

export type Store = ReturnType<typeof scoped>;

const grab = (name: "localStorage" | "sessionStorage") => {
    try {
        return window[name] ?? null;
    } catch {
        return null;
    }
};

export const browserStorage = grab("localStorage");
export const tabStorage = grab("sessionStorage");

const PENDING_KEY = "fe2ee-pending-password";

interface PendingPassword {
    userId: string;
    at: number;
    iv: string;
    ct: string;
}

const pendingKey = async () => {
    const existing = await run<CryptoKey | undefined>("readonly", (s) => s.get("pending-password-key"));
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await run<IDBValidKey>("readwrite", (s) => s.put(key, "pending-password-key"));
    return key;
};

export const holdPendingPassword = async (userId: string, value: string) => {
    const iv = randomBytes(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await pendingKey(), utf8(value)));
    try {
        tabStorage?.setItem(PENDING_KEY, JSON.stringify({ userId, at: Date.now(), iv: toB64u(iv), ct: toB64u(ct) } satisfies PendingPassword));
    } catch {
        return;
    }
};

export const takePendingPassword = async (userId: string, ttl: number) => {
    let pending: PendingPassword | null = null;
    try {
        pending = JSON.parse(tabStorage?.getItem(PENDING_KEY) ?? "null") as PendingPassword | null;
    } catch {
        return null;
    }
    if (!pending || (pending.userId && pending.userId !== userId) || Date.now() - pending.at > ttl) return null;
    try {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(pending.iv) }, await pendingKey(), fromB64u(pending.ct));
        return { value: fromUtf8(plain), at: pending.at };
    } catch {
        return null;
    }
};

export const dropPendingPassword = () => {
    try {
        tabStorage?.removeItem(PENDING_KEY);
    } catch {
        return;
    }
};
