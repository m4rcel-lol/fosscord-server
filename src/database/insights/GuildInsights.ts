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

import { Snowflake } from "@spacebar/util/util/Snowflake";
import { getDatabase } from "../Database";

const DAY = 86_400_000;
const ACTIVITY_KEEP_DAYS = 120;
const MAX_RANGE_DAYS = 120;
const VISITED = 1;
const VOICE = 2;
const ROLLUP_EVERY = 3_600_000;
const REPORT_CACHE_MS = 30_000;

export const InsightsInterval = { HOURLY: 0, DAILY: 1, WEEKLY: 2, MONTHLY: 3 } as const;

export const LEAVER_TENURE_LABELS = ["Under 1 day", "1 to 7 days", "7 to 30 days", "30 to 90 days", "Over 90 days"];
const TENURE_LIMIT_DAYS = [1, 7, 30, 90];

const DISTINCT_METRICS = ["visitors", "communicators", "voice_users", "new_communicators"];
const MAX_MERGED_METRICS = ["joins", "joins_source", "joins_invite"];

export type InsightsMetrics = Record<string, Record<string, number>>;
export type InsightsBucket = { start: string; end: string; metrics: InsightsMetrics };

type Row = { guild_id: string; day: string; metric: string; key: string; value: number };

const db = () => getDatabase()!;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const addDays = (day: string, days: number) => dayOf(dayStart(day) + days * DAY);
const snowflakeAt = (ms: number) => (BigInt(Math.max(0, ms - Snowflake.EPOCH)) << 22n).toString();

const put = (metrics: InsightsMetrics, metric: string, key: string, value: number, merge: "sum" | "max" | "set" = "sum") => {
    const bucket = (metrics[metric] ??= {});
    const previous = bucket[key];
    if (previous === undefined || merge === "set") bucket[key] = value;
    else bucket[key] = merge === "max" ? Math.max(previous, value) : previous + value;
};

const report = (scope: string) => (error: unknown) => console.error(`[Insights] ${scope} failed`, error);

const seen = { day: "", keys: new Set<string>() };
const cache = new Map<string, { at: number; value: Promise<InsightsBucket[]> }>();

export class GuildInsights {
    static day = dayOf;

    static async increment(guildId: string, entries: [metric: string, key: string, amount: number, day?: string][]) {
        const rows = entries.filter(([, , amount]) => amount > 0);
        if (!rows.length) return;
        const today = dayOf(Date.now());
        await db().query(
            `INSERT INTO "guild_insights_daily" ("guild_id", "day", "metric", "key", "value")
            SELECT $1::bigint, "day", "metric", "key", "value" FROM unnest($2::date[], $3::varchar[], $4::varchar[], $5::bigint[]) AS t("day", "metric", "key", "value")
            ON CONFLICT ("guild_id", "day", "metric", "key") DO UPDATE SET "value" = "guild_insights_daily"."value" + EXCLUDED."value"`,
            [guildId, rows.map(([, , , day]) => day ?? today), rows.map(([metric]) => metric), rows.map(([, key]) => key), rows.map(([, , amount]) => Math.round(amount))],
        );
    }

    static recordJoin(guildId: string, source?: { source_invite_code?: string | null; join_source_type?: number | null }) {
        const entries: [string, string, number][] = [
            ["joins", "", 1],
            ["joins_source", `${source?.join_source_type ?? 0}`, 1],
        ];
        if (source?.source_invite_code) entries.push(["joins_invite", source.source_invite_code, 1]);
        GuildInsights.increment(guildId, entries).catch(report("join counter"));
    }

    static recordLeave(guildId: string, joinedAt?: Date | null) {
        const days = joinedAt ? (Date.now() - new Date(joinedAt).getTime()) / DAY : Infinity;
        const bucket = TENURE_LIMIT_DAYS.findIndex((limit) => days < limit);
        GuildInsights.increment(guildId, [["leaves", `${bucket === -1 ? TENURE_LIMIT_DAYS.length : bucket}`, 1]]).catch(report("leave counter"));
    }

    static async markActivity(channelId: string, userId: string, kinds: number) {
        await db().query(
            `INSERT INTO "guild_insights_activity" ("guild_id", "day", "channel_id", "user_id", "kinds")
            SELECT "guild_id", $3::date, "id", $2::bigint, $4 FROM "channels" WHERE "id" = $1::bigint AND "guild_id" IS NOT NULL
            ON CONFLICT ("guild_id", "day", "channel_id", "user_id") DO UPDATE SET "kinds" = "guild_insights_activity"."kinds" | EXCLUDED."kinds"`,
            [channelId, userId, dayOf(Date.now()), kinds],
        );
    }

    static visit(channelId: string, userId: string) {
        const today = dayOf(Date.now());
        if (seen.day !== today || seen.keys.size > 250_000) {
            seen.day = today;
            seen.keys.clear();
        }
        const key = `${channelId}:${userId}`;
        if (seen.keys.has(key)) return;
        seen.keys.add(key);
        GuildInsights.markActivity(channelId, userId, VISITED).catch((error) => {
            seen.keys.delete(key);
            report("visit")(error);
        });
    }

    static voiceJoined(guildId: string | null | undefined, channelId: string, userId: string) {
        if (!guildId) return;
        GuildInsights.markActivity(channelId, userId, VISITED | VOICE).catch(report("voice join"));
    }

    static voiceLeft(guildId: string | null | undefined, channelId: string, connectedAt?: number | null) {
        if (!guildId || !connectedAt) return;
        const entries: [string, string, number, string][] = [];
        const end = Date.now();
        for (let from = connectedAt * 1000; from < end;) {
            const day = dayOf(from);
            const until = Math.min(end, dayStart(day) + DAY);
            const seconds = (until - from) / 1000;
            entries.push(["voice_seconds", "", seconds, day], ["voice_seconds", channelId, seconds, day]);
            from = until;
        }
        GuildInsights.increment(guildId, entries).catch(report("voice time"));
    }

    static async computeRange(startDay: string, endDay: string, guildId?: string) {
        const result = new Map<string, InsightsMetrics>();
        const of = (id: string) => result.get(id) ?? result.set(id, {}).get(id)!;
        const startMs = dayStart(startDay);
        const endMs = dayStart(endDay);
        const guildFilter = (column: string, index: number) => (guildId ? `AND ${column} = $${index}::bigint` : "");
        const params = [startDay, endDay, snowflakeAt(startMs), snowflakeAt(endMs), ...(guildId ? [guildId] : [])];

        const usage: { guild_id: string; channel_id: string | null; messages: string; visitors: string; communicators: string; voice_users: string }[] = await db().query(
            `WITH "used" AS (
                SELECT "guild_id", "channel_id", "user_id", ("kinds" & ${VOICE}) <> 0 AS "voice", false AS "sent"
                FROM "guild_insights_activity" WHERE "day" >= $1::date AND "day" < $2::date ${guildFilter(`"guild_id"`, 5)}
                UNION ALL
                SELECT "guild_id", "channel_id", "author_id", false, true
                FROM "messages" WHERE "id" >= $3::bigint AND "id" < $4::bigint AND "guild_id" IS NOT NULL ${guildFilter(`"guild_id"`, 5)}
            )
            SELECT "guild_id"::text AS "guild_id", "channel_id"::text AS "channel_id",
                count(*) FILTER (WHERE "sent") AS "messages",
                count(DISTINCT "user_id") AS "visitors",
                count(DISTINCT "user_id") FILTER (WHERE "sent" OR "voice") AS "communicators",
                count(DISTINCT "user_id") FILTER (WHERE "voice") AS "voice_users"
            FROM "used" GROUP BY GROUPING SETS (("guild_id", "channel_id"), ("guild_id"))`,
            params,
        );
        for (const row of usage) {
            const metrics = of(row.guild_id);
            const key = row.channel_id ?? "";
            put(metrics, "messages", key, Number(row.messages), "set");
            put(metrics, "visitors", key, Number(row.visitors), "set");
            put(metrics, "communicators", key, Number(row.communicators), "set");
            put(metrics, "voice_users", key, Number(row.voice_users), "set");
        }

        const startDate = new Date(startMs);
        const endDate = new Date(endMs);
        const fresh: { guild_id: string; count: string }[] = await db().query(
            `SELECT "used"."guild_id"::text AS "guild_id", count(DISTINCT "used"."user_id") AS "count" FROM (
                SELECT "guild_id", "user_id" FROM "guild_insights_activity" WHERE "day" >= $1::date AND "day" < $2::date AND ("kinds" & ${VOICE}) <> 0 ${guildFilter(`"guild_id"`, 7)}
                UNION ALL
                SELECT "guild_id", "author_id" FROM "messages" WHERE "id" >= $3::bigint AND "id" < $4::bigint AND "guild_id" IS NOT NULL ${guildFilter(`"guild_id"`, 7)}
            ) AS "used"
            JOIN "members" ON "members"."guild_id" = "used"."guild_id" AND "members"."id" = "used"."user_id"
            WHERE "members"."joined_at" >= $5 AND "members"."joined_at" < $6
            GROUP BY "used"."guild_id"`,
            [startDay, endDay, snowflakeAt(startMs), snowflakeAt(endMs), startDate, endDate, ...(guildId ? [guildId] : [])],
        );
        for (const row of fresh) put(of(row.guild_id), "new_communicators", "", Number(row.count), "set");

        const joins: { guild_id: string; source: number | null; code: string | null; by_source: number; by_code: number; count: string }[] = await db().query(
            `SELECT "guild_id"::text AS "guild_id", "join_source_type" AS "source", "source_invite_code" AS "code",
                GROUPING("join_source_type") AS "by_source", GROUPING("source_invite_code") AS "by_code", count(*) AS "count"
            FROM "members" WHERE "joined_at" >= $1 AND "joined_at" < $2 ${guildFilter(`"guild_id"`, 3)}
            GROUP BY GROUPING SETS (("guild_id"), ("guild_id", "join_source_type"), ("guild_id", "source_invite_code"))`,
            [startDate, endDate, ...(guildId ? [guildId] : [])],
        );
        for (const row of joins) {
            const metrics = of(row.guild_id);
            const count = Number(row.count);
            if (row.by_source && row.by_code) put(metrics, "joins", "", count, "max");
            else if (!row.by_source) put(metrics, "joins_source", `${row.source ?? 0}`, count, "sum");
            else if (row.code) put(metrics, "joins_invite", row.code, count, "max");
        }
        return result;
    }

    static async membership(day: string, guildId?: string) {
        const rows: { guild_id: string; count: string }[] = await db().query(
            `SELECT "guilds"."id"::text AS "guild_id",
                (SELECT count(*) FROM "members" WHERE "members"."guild_id" = "guilds"."id" AND "members"."joined_at" < $1)
                + (SELECT coalesce(sum("value"), 0) FROM "guild_insights_daily" AS "daily" WHERE "daily"."guild_id" = "guilds"."id" AND "daily"."metric" = 'leaves' AND "daily"."day" > $2::date) AS "count"
            FROM "guilds" ${guildId ? `WHERE "guilds"."id" = $3::bigint` : ""}`,
            [new Date(dayStart(day) + DAY), day, ...(guildId ? [guildId] : [])],
        );
        return new Map(rows.map((row) => [row.guild_id, Number(row.count)]));
    }

    static async retained(cohortDay: string, guildId?: string) {
        const rows: { guild_id: string; count: string }[] = await db().query(
            `SELECT "guild_id"::text AS "guild_id", count(*) AS "count" FROM "members" WHERE "joined_at" >= $1 AND "joined_at" < $2 ${guildId ? `AND "guild_id" = $3::bigint` : ""} GROUP BY "guild_id"`,
            [new Date(dayStart(cohortDay)), new Date(dayStart(cohortDay) + DAY), ...(guildId ? [guildId] : [])],
        );
        return new Map(rows.map((row) => [row.guild_id, Number(row.count)]));
    }

    static async write(rows: Row[]) {
        for (let i = 0; i < rows.length; i += 5000) {
            const batch = rows.slice(i, i + 5000);
            await db().query(
                `INSERT INTO "guild_insights_daily" ("guild_id", "day", "metric", "key", "value")
                SELECT * FROM unnest($1::bigint[], $2::date[], $3::varchar[], $4::varchar[], $5::bigint[])
                ON CONFLICT ("guild_id", "day", "metric", "key") DO UPDATE SET "value" = CASE WHEN EXCLUDED."metric" IN (${MAX_MERGED_METRICS.map((m) => `'${m}'`).join(", ")}) THEN GREATEST("guild_insights_daily"."value", EXCLUDED."value") ELSE EXCLUDED."value" END`,
                [batch.map((r) => r.guild_id), batch.map((r) => r.day), batch.map((r) => r.metric), batch.map((r) => r.key), batch.map((r) => r.value)],
            );
        }
    }

    static async rollup(day: string) {
        const claimed = await db().query(`INSERT INTO "guild_insights_rollups" ("day") VALUES ($1::date) ON CONFLICT DO NOTHING RETURNING "day"`, [day]);
        if (!claimed.length) return false;
        try {
            const rows: Row[] = [];
            const computed = await GuildInsights.computeRange(day, addDays(day, 1));
            for (const [guild_id, metrics] of computed)
                for (const [metric, keys] of Object.entries(metrics)) for (const [key, value] of Object.entries(keys)) rows.push({ guild_id, day, metric, key, value });

            for (const [guild_id, value] of await GuildInsights.membership(day)) if (value > 0) rows.push({ guild_id, day, metric: "members", key: "", value });

            const cohort = addDays(day, -7);
            const retained = await GuildInsights.retained(cohort);
            const cohortJoins: { guild_id: string }[] = await db().query(
                `SELECT "guild_id"::text AS "guild_id" FROM "guild_insights_daily" WHERE "day" = $1::date AND "metric" = 'joins' AND "key" = '' AND "value" > 0`,
                [cohort],
            );
            for (const { guild_id } of cohortJoins) if (!retained.has(guild_id)) retained.set(guild_id, 0);
            for (const [guild_id, value] of retained) rows.push({ guild_id, day: cohort, metric: "retained", key: "", value });

            await GuildInsights.write(rows);
            return true;
        } catch (error) {
            await db().query(`DELETE FROM "guild_insights_rollups" WHERE "day" = $1::date`, [day]);
            throw error;
        }
    }

    static async rollupPending() {
        const today = dayOf(Date.now());
        const first = addDays(today, -MAX_RANGE_DAYS);
        const done: { day: string }[] = await db().query(`SELECT to_char("day", 'YYYY-MM-DD') AS "day" FROM "guild_insights_rollups" WHERE "day" >= $1::date`, [first]);
        const doneDays = new Set(done.map((row) => row.day));
        let rolled = 0;
        for (let day = first; day < today; day = addDays(day, 1)) if (!doneDays.has(day) && (await GuildInsights.rollup(day))) rolled++;
        await db().query(`DELETE FROM "guild_insights_activity" WHERE "day" < $1::date`, [addDays(today, -ACTIVITY_KEEP_DAYS)]);
        if (rolled) console.log(`[Insights] rolled up ${rolled} day${rolled === 1 ? "" : "s"}`);
        return rolled;
    }

    static startRollups() {
        const run = () => void GuildInsights.rollupPending().catch(report("rollup"));
        setTimeout(run, 15_000).unref();
        return setInterval(run, ROLLUP_EVERY).unref();
    }

    static async daily(guildId: string, startDay: string, endDay: string) {
        const days = new Map<string, InsightsMetrics>();
        for (let day = startDay; day <= endDay; day = addDays(day, 1)) days.set(day, {});

        const stored: Row[] = await db().query(
            `SELECT to_char("day", 'YYYY-MM-DD') AS "day", "metric", "key", "value"::float8 AS "value" FROM "guild_insights_daily" WHERE "guild_id" = $1::bigint AND "day" >= $2::date AND "day" <= $3::date`,
            [guildId, startDay, endDay],
        );
        for (const row of stored) put(days.get(row.day)!, row.metric, row.key, Number(row.value), "set");

        const rolled: { day: string }[] = await db().query(
            `SELECT to_char("day", 'YYYY-MM-DD') AS "day" FROM "guild_insights_rollups" WHERE "day" >= $1::date AND "day" <= $2::date`,
            [startDay, endDay],
        );
        const rolledDays = new Set(rolled.map((row) => row.day));
        const now = Date.now();
        const today = dayOf(now);

        const openSessions: { channel_id: string; connected_at: string }[] = await db().query(
            `SELECT "channel_id"::text AS "channel_id", "connected_at"::text AS "connected_at" FROM "voice_states" WHERE "guild_id" = $1::bigint AND "channel_id" IS NOT NULL AND "connected_at" IS NOT NULL`,
            [guildId],
        );

        for (const [day, metrics] of days) {
            if (day > today) continue;
            if (!rolledDays.has(day) && day >= addDays(today, -2)) {
                const live = (await GuildInsights.computeRange(day, addDays(day, 1), guildId)).get(guildId) ?? {};
                for (const [metric, keys] of Object.entries(live))
                    for (const [key, value] of Object.entries(keys)) put(metrics, metric, key, value, MAX_MERGED_METRICS.includes(metric) ? "max" : "set");
                const members = (await GuildInsights.membership(day, guildId)).get(guildId);
                if (members) put(metrics, "members", "", members, "set");
            }
            const from = dayStart(day);
            const until = Math.min(now, from + DAY);
            for (const session of openSessions) {
                const seconds = (until - Math.max(from, Number(session.connected_at) * 1000)) / 1000;
                if (seconds <= 0) continue;
                put(metrics, "voice_seconds", "", seconds);
                put(metrics, "voice_seconds", session.channel_id, seconds);
            }
            if (metrics.retained === undefined && day <= addDays(today, -8) && (metrics.joins?.[""] ?? 0) > 0)
                put(metrics, "retained", "", (await GuildInsights.retained(day, guildId)).get(guildId) ?? 0, "set");
        }
        return days;
    }

    static bucketOf(day: string, interval: number) {
        if (interval === InsightsInterval.WEEKLY) return addDays(day, -new Date(dayStart(day)).getUTCDay());
        if (interval === InsightsInterval.MONTHLY) return `${day.slice(0, 8)}01`;
        return day;
    }

    static report(guildId: string, start: Date | null, end: Date | null, interval: number) {
        const now = Date.now();
        const endMs = Math.min(end && !Number.isNaN(end.getTime()) ? end.getTime() : now, now);
        const startMs = Math.max(start && !Number.isNaN(start.getTime()) ? start.getTime() : endMs - 30 * DAY, endMs - MAX_RANGE_DAYS * DAY);
        const startDay = dayOf(Math.min(startMs, endMs));
        const endDay = dayOf(endMs);
        const key = `${guildId}:${startDay}:${endDay}:${interval}`;
        for (const [k, entry] of cache) if (now - entry.at > REPORT_CACHE_MS) cache.delete(k);
        const hit = cache.get(key);
        if (hit) return hit.value;
        const value = GuildInsights.buildReport(guildId, startDay, endDay, interval);
        cache.set(key, { at: now, value });
        value.catch(() => cache.delete(key));
        return value;
    }

    static async buildReport(guildId: string, startDay: string, endDay: string, interval: number) {
        const days = await GuildInsights.daily(guildId, startDay, endDay);
        const buckets = new Map<string, InsightsBucket & { retainedJoins: number }>();
        for (const [day, metrics] of days) {
            const start = GuildInsights.bucketOf(day, interval);
            const bucket = buckets.get(start) ?? buckets.set(start, { start, end: day, metrics: {}, retainedJoins: 0 }).get(start)!;
            bucket.end = day;
            for (const [metric, keys] of Object.entries(metrics)) {
                if (metric === "members") continue;
                for (const [key, value] of Object.entries(keys)) put(bucket.metrics, metric, key, value);
            }
            if (metrics.members?.[""] !== undefined) put(bucket.metrics, "members", "", metrics.members[""], "set");
            if (metrics.retained?.[""] !== undefined) bucket.retainedJoins += metrics.joins?.[""] ?? 0;
        }

        for (const bucket of buckets.values()) {
            if (bucket.metrics.retained) put(bucket.metrics, "retained_joins", "", bucket.retainedJoins, "set");
            if (interval !== InsightsInterval.WEEKLY && interval !== InsightsInterval.MONTHLY) continue;
            const distinct = (await GuildInsights.computeRange(bucket.start < startDay ? startDay : bucket.start, addDays(bucket.end, 1), guildId)).get(guildId) ?? {};
            for (const metric of DISTINCT_METRICS) bucket.metrics[metric] = { ...(distinct[metric] ?? {}) };
        }

        return [...buckets.values()].map(({ start, end, metrics }) => ({ start, end, metrics })).sort((a, b) => (a.start < b.start ? 1 : -1));
    }
}
