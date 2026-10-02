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

import { Config, extractVideoFrame, verifyExternalPath } from "@spacebar/util";
import { Request, Response } from "express";
import { Readable } from "node:stream";

const MAX_SIZE = 50 * 1024 * 1024;
const PASSTHROUGH_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export async function ExternalProxy(req: Request, res: Response) {
    const [, , hash, ...rest] = req.originalUrl.split("?")[0].split("/");
    const path = rest.join("/");
    if (!hash || !verifyExternalPath(hash, path)) return res.status(403).send("Invalid signature");

    const search = rest[0]?.startsWith("%3F") ? decodeURIComponent(rest.shift()!) : "";
    const [protocol, ...location] = rest;
    if (protocol !== "https" && protocol !== "http") return res.status(400).send("Invalid protocol");

    const target = `${protocol}://${location.join("/")}${search}`;
    if (req.query.format) {
        const head = await fetch(target, { method: "HEAD", signal: AbortSignal.timeout(10000) }).catch(() => null);
        if (head?.headers.get("content-type")?.startsWith("video/")) {
            const frame = await extractVideoFrame(target);
            if (!frame) return res.status(415).send("Unable to render a preview frame");
            res.setHeader("content-type", "image/jpeg");
            res.setHeader("cache-control", `public, max-age=${Config.get().cdn.proxyCacheHeaderSeconds}`);
            res.setHeader("access-control-allow-origin", "*");
            res.setHeader("cross-origin-resource-policy", "cross-origin");
            return res.send(frame);
        }
    }

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    const upstream = await fetch(target, {
        headers: {
            "user-agent": Config.get().embeds.defaultUserAgent ?? "Mozilla/5.0 (compatible; Spacebar/1.0; +https://github.com/spacebarchat/server)",
            ...(req.headers.range && { range: req.headers.range }),
        },
        signal: abort.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (!upstream?.body) return res.status(502).send("Unable to reach origin");
    if (!upstream.ok) return res.status(upstream.status).send(`Origin responded with ${upstream.status}`);
    if (Number(upstream.headers.get("content-length")) > MAX_SIZE) return res.status(413).send("Origin response too large");

    const type = upstream.headers.get("content-type") ?? "";
    if (!/^(image|video|audio)\//.test(type)) return res.status(415).send("Unsupported media type");

    res.status(upstream.status);
    for (const header of PASSTHROUGH_HEADERS) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
    }
    res.setHeader("cache-control", `public, max-age=${Config.get().cdn.proxyCacheHeaderSeconds}`);
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cross-origin-resource-policy", "cross-origin");
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
}
