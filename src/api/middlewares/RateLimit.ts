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

import { Config, listenEvent, RabbitMQ } from "@spacebar/util";
import { RateLimit as StoredRateLimit } from "@spacebar/database";
import { NextFunction, Request, Response, Router } from "express";
import { LessThanOrEqual } from "typeorm";

export const API_PREFIX_TRAILING_SLASH = /^\/api(\/v\d+)?\//;

type RateLimit = {
    id: string;
    executor_id: string;
    hits: number;
    blocked: boolean;
    expires_at: Date;
};

const Cache = new Map<string, RateLimit>();
const EventRateLimit = "RATELIMIT";
const InvalidRequestStatuses = new Set([401, 403, 429]);
const MajorParameters = new Set(["channels", "guilds", "webhooks"]);
const Snowflake = /^\d{15,20}$/;
const PersistedWindow = 60;
let limiterCount = 0;

export function routeBucket(req: Request) {
    const segments = req.originalUrl.split("?")[0].replace(API_PREFIX_TRAILING_SLASH, "").split("/");
    const path = segments
        .map((segment, i) => {
            const previous = segments[i - 1];
            if (previous === "reactions") return ":emoji";
            if (i === 2 && segments[0] === "webhooks") return ":token";
            if (Snowflake.test(segment) && !(i === 1 && MajorParameters.has(previous))) return ":id";
            return segment;
        })
        .join("/");
    return `${req.method} ${path}`;
}

export default function rateLimit(opts: {
    bucket?: string;
    window: number;
    count: number;
    bot?: number;
    webhook?: number;
    oauth?: number;
    GET?: number;
    MODIFY?: number;
    error?: boolean;
    success?: boolean;
    onlyIp?: boolean;
    onlyUsers?: boolean;
    onlyAnonymous?: boolean;
    onlyWrites?: boolean;
    global?: boolean;
}) {
    const limiterId = opts.bucket ?? `route${++limiterCount}`;
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.method === "OPTIONS") return next();
        if (opts.onlyWrites && ["GET", "HEAD"].includes(req.method)) return next();
        if (opts.onlyUsers && !req.user_id) return next();
        if (opts.onlyAnonymous && req.user_id) return next();
        if (req.rights?.has("BYPASS_RATE_LIMITS")) return next();

        const bucket_id = opts.bucket || routeBucket(req);
        const executor_id = !opts.onlyIp && req.user_id ? req.user_id : req.ip || "127.0.0.1";
        const key = `${executor_id}:${limiterId}:${bucket_id}`;

        let max_hits = opts.count;
        if (opts.bot && req.user_bot) max_hits = opts.bot;
        if (opts.GET && ["GET", "HEAD"].includes(req.method)) max_hits = opts.GET;
        else if (opts.MODIFY && ["POST", "DELETE", "PATCH", "PUT"].includes(req.method)) max_hits = opts.MODIFY;

        const now = Date.now();
        const setHeaders = (limit: RateLimit | undefined) => {
            const reset = limit?.expires_at.getTime() ?? now + opts.window * 1000;
            res.set("X-RateLimit-Limit", `${max_hits}`)
                .set("X-RateLimit-Remaining", `${Math.max(0, max_hits - (limit?.hits ?? 0))}`)
                .set("X-RateLimit-Bucket", bucket_id)
                .set("X-RateLimit-Reset", `${(reset / 1000).toFixed(3)}`)
                .set("X-RateLimit-Reset-After", `${(Math.max(0, reset - now) / 1000).toFixed(3)}`);
        };
        const reject = (limit: RateLimit) => {
            const retryAfter = Math.max(0, limit.expires_at.getTime() - now) / 1000;
            setHeaders(limit);
            if (opts.global) res.set("X-RateLimit-Global", "true");
            return res
                .status(429)
                .set("X-RateLimit-Remaining", "0")
                .set("Retry-After", `${Math.ceil(retryAfter)}`)
                .set("X-RateLimit-Scope", opts.global ? "global" : "user")
                .send({
                    message: "You are being rate limited.",
                    retry_after: Number(retryAfter.toFixed(3)),
                    global: !!opts.global,
                });
        };
        const counts = () => (opts.error ? InvalidRequestStatuses.has(res.statusCode) : res.statusCode >= 200 && res.statusCode < 300);
        const hitOpts = { key, bucket_id, executor_id, max_hits, window: opts.window };

        if (!opts.global && opts.window >= PersistedWindow) {
            (async () => {
                if (opts.error || opts.success) {
                    const stored = await StoredRateLimit.findOne({ where: { id: key } });
                    const current = stored && stored.expires_at.getTime() > now ? stored : undefined;
                    if (current && current.hits >= max_hits) return reject(current);
                    setHeaders(current);
                    res.once("finish", () => {
                        if (counts()) StoredRateLimit.hit(key, executor_id, max_hits, opts.window).catch((e) => console.error("[RateLimit] failed to store hit", e));
                    });
                    return next();
                }
                const limit = await StoredRateLimit.hit(key, executor_id, max_hits, opts.window);
                if (limit.hits > max_hits) return reject(limit);
                setHeaders(limit);
                next();
            })().catch(next);
            return;
        }

        let entry = Cache.get(key);
        if (entry && entry.expires_at.getTime() <= now) {
            Cache.delete(key);
            entry = undefined;
        }
        if (entry?.blocked) return reject(entry);

        if (opts.error || opts.success) {
            setHeaders(entry);
            res.once("finish", () => {
                if (counts()) hitRoute(hitOpts);
            });
        } else setHeaders(hitRoute(hitOpts));

        next();
    };
}

export async function initRateLimits(app: Router) {
    const { routes, global, ip, error, enabled } = Config.get().limits.rate;
    if (!enabled) return;
    console.log("Enabling rate limits...");

    const setupRateLimitListener = async () => {
        await listenEvent(EventRateLimit, (event) => {
            Cache.set(event.channel_id as string, event.data);
            event.acknowledge?.();
        });
    };

    await setupRateLimitListener();

    RabbitMQ.on("reconnected", async () => {
        console.log("[RateLimit] RabbitMQ reconnected, re-establishing rate limit listener");
        await setupRateLimitListener();
    });

    setInterval(() => {
        const now = Date.now();
        Cache.forEach((x, key) => {
            if (x.expires_at.getTime() <= now) Cache.delete(key);
        });
        StoredRateLimit.delete({ expires_at: LessThanOrEqual(new Date(now)) }).catch((e) => console.error("[RateLimit] failed to prune stored limits", e));
    }, 1000 * 60).unref();

    app.use(rateLimit({ bucket: "ip", onlyIp: true, onlyAnonymous: true, global: true, ...ip }));
    app.use(rateLimit({ bucket: "global", onlyUsers: true, global: true, ...global }));
    app.use(rateLimit({ bucket: "error", error: true, onlyIp: true, global: true, ...error }));
    app.post(["/guilds", "/guilds/templates/:code"], rateLimit({ bucket: "guild-create", ...routes.guildCreate }));
    app.use("/guilds/:guild_id", rateLimit(routes.guild));
    app.use("/webhooks/:webhook_id", rateLimit(routes.webhook));
    app.use("/channels/:channel_id", rateLimit(routes.channel));
    app.patch("/users/@me", rateLimit(routes.userProfile));
    app.use("/users/@me", rateLimit({ onlyWrites: true, ...routes.user }));
    app.use("/invites/:code", rateLimit({ onlyWrites: true, ...routes.invite }));
    app.use(
        ["/guilds/:guild_id/emojis", "/guilds/:guild_id/stickers", "/guilds/:guild_id/soundboard-sounds", "/applications/:application_id/emojis"],
        rateLimit({ onlyWrites: true, ...routes.expression }),
    );
    app.use(["/applications", "/teams", "/oauth2/applications"], rateLimit({ onlyWrites: true, ...routes.application }));
    app.use("/interactions", rateLimit({ onlyWrites: true, ...routes.interaction }));
    app.use(["/oauth2/authorize", "/oauth2/token", "/oauth2/tokens"], rateLimit({ onlyWrites: true, ...routes.oauth2 }));
    app.use(["/reporting", "/safety-hub", "/attachments/report-false-positive", "/attachments/sender-report-false-positive"], rateLimit({ onlyWrites: true, ...routes.report }));
    app.use("/read-states", rateLimit({ onlyWrites: true, ...routes.readState }));
    app.use("/stage-instances", rateLimit({ onlyWrites: true, ...routes.channel }));
    app.use("/streams", rateLimit({ onlyWrites: true, ...routes.stream }));
    app.use("/connections", rateLimit({ onlyWrites: true, ...routes.connection }));
    app.use("/attachments", rateLimit({ onlyWrites: true, ...routes.attachment }));
    app.use(["/auth/logout", "/auth/sessions", "/messages"], rateLimit({ onlyWrites: true, ...routes.user }));
    app.use("/phone-verifications", rateLimit({ onlyWrites: true, ...routes.auth.phone }));
    app.use("/auth/login", rateLimit(routes.auth.login));
    app.use(["/auth/mfa", "/mfa/finish", "/auth/conditional", "/auth/passwordless", "/auth/forgot", "/auth/reset", "/auth/verify"], rateLimit(routes.auth.login));
    app.use("/auth/register", rateLimit({ onlyIp: true, success: true, ...routes.auth.register }));
}

function hitRoute(opts: { key: string; executor_id: string; bucket_id: string; max_hits: number; window: number }) {
    let limit = Cache.get(opts.key);
    if (!limit || limit.expires_at.getTime() <= Date.now()) {
        limit = {
            id: opts.bucket_id,
            executor_id: opts.executor_id,
            expires_at: new Date(Date.now() + opts.window * 1000),
            hits: 0,
            blocked: false,
        };
        Cache.set(opts.key, limit);
    }

    limit.hits++;
    if (limit.hits >= opts.max_hits) limit.blocked = true;
    return limit;
}
