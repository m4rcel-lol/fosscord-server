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

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_VIDEO_SIZE = 64 * 1024 * 1024;
let ffmpegMissing = false;

const runFfmpeg = (file: string, timeoutMs: number) =>
    new Promise<Buffer | null>((resolve) => {
        const ffmpeg = spawn(
            process.env.FFMPEG_PATH || "ffmpeg",
            ["-loglevel", "error", "-i", file, "-frames:v", "1", "-vf", "scale=min(iw\\,1280):-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "pipe:1"],
            {
                stdio: ["ignore", "pipe", "ignore"],
            },
        );
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => ffmpeg.kill("SIGKILL"), timeoutMs);
        ffmpeg.on("error", () => {
            ffmpegMissing = true;
            clearTimeout(timer);
            resolve(null);
        });
        ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
        ffmpeg.on("close", (code) => {
            clearTimeout(timer);
            resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null);
        });
    });

export async function extractVideoFrame(input: string | Buffer, timeoutMs = 15000): Promise<Buffer | null> {
    if (ffmpegMissing) return null;
    let data: Buffer;
    if (typeof input === "string") {
        const res = await fetch(input, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
        if (!res?.ok || Number(res.headers.get("content-length")) > MAX_VIDEO_SIZE) return null;
        data = Buffer.from(await res.arrayBuffer());
    } else data = input;
    if (data.length > MAX_VIDEO_SIZE) return null;

    const file = path.join(tmpdir(), `sb-frame-${randomBytes(8).toString("hex")}`);
    await writeFile(file, data);
    try {
        return await runFfmpeg(file, timeoutMs);
    } finally {
        await rm(file, { force: true });
    }
}

export const readVideoDimensions = (buf: Buffer): { width: number; height: number } | undefined => {
    for (let i = buf.indexOf("tkhd"); i !== -1; i = buf.indexOf("tkhd", i + 4)) {
        const start = i - 4;
        const size = start >= 0 ? buf.readUInt32BE(start) : 0;
        if (size < 84 || start + size > buf.length) continue;
        const width = buf.readUInt32BE(start + size - 8) >>> 16;
        const height = buf.readUInt32BE(start + size - 4) >>> 16;
        if (width && height) return { width, height };
    }
    const readVint = (at: number) => {
        const first = buf[at];
        const length = Math.clz32(first) - 23;
        if (length < 1 || length > 8) return undefined;
        let value = first & ((1 << (8 - length)) - 1);
        for (let j = 1; j < length; j++) value = value * 256 + buf[at + j];
        return { length, value };
    };
    for (let i = buf.indexOf(0xe0); i !== -1; i = buf.indexOf(0xe0, i + 1)) {
        const size = readVint(i + 1);
        if (!size || size.value > 256) continue;
        const end = i + 1 + size.length + size.value;
        const dims: Record<number, number> = {};
        for (let at = i + 1 + size.length; at < end && at < buf.length;) {
            const id = buf[at];
            const len = readVint(at + 1);
            if (!len) break;
            const valueAt = at + 1 + len.length;
            if ((id === 0xb0 || id === 0xba) && len.value <= 4) dims[id] = buf.readUIntBE(valueAt, len.value);
            at = valueAt + len.value;
        }
        if (dims[0xb0] && dims[0xba]) return { width: dims[0xb0], height: dims[0xba] };
    }
};
