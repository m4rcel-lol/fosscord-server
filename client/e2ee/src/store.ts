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
