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

import { Bytes, fromB64u, utf8 } from "./bytes";

export const FILE_CHUNK = 64 * 1024;
export const FILE_PREFIX = "/e2ee/attachments/";
export const SW_PATH = "/e2ee-sw.js";
const TAG = 16;

export interface FileMeta {
    name: string;
    filename: string;
    content_type: string;
    size: number;
    key: string;
    iv: string;
    width?: number;
    height?: number;
    duration_secs?: number;
    waveform?: string;
    description?: string;
    spoiler?: boolean;
}

export interface StickerMeta {
    id: string;
    name: string;
    format_type: number;
}

export interface Payload {
    content: string;
    attachments?: FileMeta[];
    stickers?: StickerMeta[];
}

export interface FileEntry {
    url: string;
    key: string;
    iv: string;
    content_type: string;
    filename: string;
    size: number;
}

export const encryptedSize = (size: number) => size + TAG * Math.max(1, Math.ceil(size / FILE_CHUNK));

const chunkNonce = (iv: Bytes, index: number) => {
    const nonce = iv.slice();
    const view = new DataView(nonce.buffer);
    view.setUint32(8, (view.getUint32(8) ^ index) >>> 0);
    return nonce;
};

const chunkAad = (index: number, final: boolean) => utf8(`fosscord-e2ee/v1/file\n${index}\n${final ? 1 : 0}`);

const fileKey = (raw: Bytes, usage: KeyUsage) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [usage]);

export const encryptFile = async (blob: Blob, raw: Bytes, iv: Bytes) => {
    const key = await fileKey(raw, "encrypt");
    const count = Math.max(1, Math.ceil(blob.size / FILE_CHUNK));
    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < count; i++) {
        const plain = await blob.slice(i * FILE_CHUNK, (i + 1) * FILE_CHUNK).arrayBuffer();
        parts.push(await crypto.subtle.encrypt({ name: "AES-GCM", iv: chunkNonce(iv, i), additionalData: chunkAad(i, i === count - 1) }, key, plain));
    }
    return new Blob(parts, { type: "application/octet-stream" });
};

export const decryptFile = async (data: ArrayBuffer, rawKey: string, rawIv: string) => {
    const key = await fileKey(fromB64u(rawKey), "decrypt");
    const iv = fromB64u(rawIv);
    if (iv.length !== 12) throw new Error("bad file nonce");
    const count = Math.max(1, Math.ceil(data.byteLength / (FILE_CHUNK + TAG)));
    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < count; i++) {
        const chunk = data.slice(i * (FILE_CHUNK + TAG), (i + 1) * (FILE_CHUNK + TAG));
        parts.push(await crypto.subtle.decrypt({ name: "AES-GCM", iv: chunkNonce(iv, i), additionalData: chunkAad(i, i === count - 1) }, key, chunk));
    }
    return parts;
};

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm|aac|flac|x-wav|x-flac)|application\/pdf)$/;
const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-sh|x-python|toml|yaml|x-yaml)$|image\/svg)/;

export const servedType = (type: string) => {
    const base = type.split(";")[0].trim().toLowerCase();
    if (SAFE_INLINE.test(base)) return { type: base, inline: true };
    if (TEXTUAL.test(base)) return { type: "text/plain; charset=utf-8", inline: true };
    return { type: "application/octet-stream", inline: false };
};

const str = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

const parseFile = (item: Record<string, unknown> | null): FileMeta[] => {
    const name = str(item?.name, 200);
    const filename = str(item?.filename, 1024);
    const key = str(item?.key, 64);
    const iv = str(item?.iv, 32);
    const size = num(item?.size);
    if (!item || !name || !filename || !key || !iv || size === undefined) return [];
    const meta: FileMeta = { name, filename, key, iv, size, content_type: str(item.content_type, 255) ?? "application/octet-stream" };
    const width = num(item.width);
    const height = num(item.height);
    if (width && height) Object.assign(meta, { width, height });
    const duration = num(item.duration_secs);
    if (duration !== undefined) meta.duration_secs = duration;
    const waveform = str(item.waveform, 4096);
    if (waveform) meta.waveform = waveform;
    const description = str(item.description, 1024);
    if (description) meta.description = description;
    if (item.spoiler === true) meta.spoiler = true;
    return [meta];
};

export const parsePayload = (raw: unknown): Payload => {
    const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const payload: Payload = { content: typeof value.content === "string" ? value.content : "" };
    if (Array.isArray(value.attachments)) payload.attachments = value.attachments.flatMap(parseFile);
    if (Array.isArray(value.stickers))
        payload.stickers = value.stickers.flatMap((item: Record<string, unknown> | null) => {
            const id = str(item?.id, 32);
            if (!id || !/^\d+$/.test(id)) return [];
            return [{ id, name: str(item?.name, 100) ?? "", format_type: num(item?.format_type) ?? 1 }];
        });
    return payload;
};
