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

import { Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import { storage } from "./Storage";

const EXTENSION_TYPES: Record<string, string> = {
    svg: "image/svg+xml",
    json: "application/json",
    lottie: "application/json",
    riv: "application/octet-stream",
    webm: "video/webm",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
};

export async function sendAsset(res: Response, data: Buffer, name: string) {
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    const type =
        (await fileTypeFromBuffer(data))?.mime ??
        EXTENSION_TYPES[extension] ??
        (data.subarray(0, 256).toString("utf8").includes("<svg") ? "image/svg+xml" : "application/octet-stream");
    res.set("Content-Type", type);
    return res.send(data);
}

const inflight = new Map<string, Promise<Buffer | null>>();

export function fetchUpstreamAsset(path: string, url: string): Promise<Buffer | null> {
    const pending = inflight.get(path);
    if (pending) return pending;
    const task = (async () => {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            await storage.set(path, buffer);
            return buffer;
        } catch {
            return null;
        } finally {
            inflight.delete(path);
        }
    })();
    inflight.set(path, task);
    return task;
}
