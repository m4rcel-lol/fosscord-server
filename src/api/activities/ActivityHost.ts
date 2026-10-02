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

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextFunction, Request, Response } from "express";
import { EmbeddedActivity } from "@spacebar/database";
import { Config } from "@spacebar/util";
import { BUILTIN_ACTIVITIES } from "./index";

const LOOKUP_TTL = 30_000;
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "accept-encoding",
    "content-encoding",
    "content-length",
    "set-cookie",
]);

const lookups = new Map<string, { activity: EmbeddedActivity | null; expires: number }>();

const lookup = async (applicationId: string) => {
    const cached = lookups.get(applicationId);
    if (cached && cached.expires > Date.now()) return cached.activity;
    const activity = await EmbeddedActivity.findOne({ where: { application_id: applicationId } });
    lookups.set(applicationId, { activity, expires: Date.now() + LOOKUP_TTL });
    return activity;
};

export const activityHostBase = () =>
    (Config.get().client.activityApplicationHost ?? "")
        .replace(/^(https?:)?\/\//, "")
        .replace(/[:/].*$/, "")
        .toLowerCase();

const matchesPrefix = (pathname: string, prefix: string) => {
    const base = prefix.replace(/\/+$/, "");
    return !base || pathname === base || pathname.startsWith(`${base}/`);
};

async function proxy(req: Request, res: Response, target: string, rest: string, search: string) {
    const base = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`);
    const url = `${base.origin}${base.pathname.replace(/\/+$/, "")}${rest}${search}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && !HOP_BY_HOP.has(name)) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    headers.set("x-forwarded-host", req.headers.host ?? "");
    headers.set("x-forwarded-proto", req.protocol);
    if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstream = await fetch(url, {
        method: req.method,
        headers,
        redirect: "manual",
        ...(hasBody && { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }),
    } as RequestInit);
    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.has(name)) res.setHeader(name, value);
    });
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    if (!upstream.body) return res.end();
    await pipeline(Readable.fromWeb(upstream.body as never), res);
}

async function serve(applicationId: string, req: Request, res: Response) {
    const activity = await lookup(applicationId);
    if (!activity) return res.status(404).type("text/plain").send("Unknown activity");

    const [pathname, query] = req.url.split(/\?(.*)/s);
    const search = query ? `?${query}` : "";
    const inner = pathname === "/.proxy" ? "/" : pathname.startsWith("/.proxy/") ? pathname.slice("/.proxy".length) : pathname;
    const mapping = [...activity.url_mappings].sort((a, b) => b.prefix.length - a.prefix.length).find((m) => matchesPrefix(inner, m.prefix));
    if (!mapping) return res.status(404).type("text/plain").send("No URL mapping for this path");
    const rest = `/${inner.slice(mapping.prefix.replace(/\/+$/, "").length).replace(/^\/+/, "")}`;

    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    if (!mapping.target.startsWith("builtin://")) return proxy(req, res, mapping.target, rest, search);

    const builtin = BUILTIN_ACTIVITIES[mapping.target.slice("builtin://".length)];
    if (!builtin) return res.status(404).type("text/plain").send("Unknown activity");
    res.locals.applicationId = applicationId;
    req.url = `${rest}${search}`;
    builtin.router(req, res, () => {
        if (!res.headersSent) res.status(404).type("text/plain").send("Not found");
    });
}

export function ActivityHost(req: Request, res: Response, next: NextFunction) {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    const match = /^(\d{15,21})\.([a-z0-9.-]+)$/.exec(hostname);
    if (!match) return next();
    const base = activityHostBase();
    if (base && match[2] !== base) return next();
    serve(match[1], req, res).catch((error) => {
        console.error(`[Activities] ${req.method} ${hostname}${req.url} failed:`, error?.message ?? error);
        if (!res.headersSent) res.status(502).type("text/plain").send("Bad gateway");
        else res.end();
    });
}
