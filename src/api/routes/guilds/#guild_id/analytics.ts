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

import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Channel, GuildInsights, InsightsBucket, InsightsInterval, LEAVER_TENURE_LABELS } from "@spacebar/database";
import { ChannelType } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const VOICE_TYPES = [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE];
const JOIN_SOURCES: Record<string, string> = { "1": "bot_joins", "2": "integration_joins", "3": "discovery_joins", "4": "hubs_joins", "5": "invites", "6": "vanity_joins" };

type Context = { guildId: string; buckets: InsightsBucket[] };

const value = (bucket: InsightsBucket, metric: string, key = "") => bucket.metrics[metric]?.[key] ?? 0;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : null);
const stamp = (bucket: InsightsBucket) => {
    const iso = `${bucket.start}T00:00:00.000Z`;
    return { day_pt: iso, interval_start_timestamp: iso };
};

const channelRows = async ({ guildId, buckets }: Context, voice: boolean) => {
    const ids = new Set(buckets.flatMap((bucket) => Object.keys({ ...bucket.metrics.messages, ...bucket.metrics.visitors, ...bucket.metrics.voice_seconds }).filter(Boolean)));
    const channels = ids.size ? await Channel.find({ where: { guild_id: guildId, id: In([...ids]) }, select: { id: true, name: true, type: true } }) : [];
    return buckets.flatMap((bucket) =>
        channels
            .filter((channel) => VOICE_TYPES.includes(channel.type) === voice)
            .map((channel) => {
                const participators = value(bucket, voice ? "voice_users" : "visitors", channel.id);
                const communicators = value(bucket, "communicators", channel.id);
                return {
                    ...stamp(bucket),
                    channel_id: channel.id,
                    channel_name: channel.name,
                    participators,
                    communicators,
                    messages_sent: value(bucket, "messages", channel.id),
                    speaking_minutes: Math.round(value(bucket, "voice_seconds", channel.id) / 60),
                    pct_participated_in_channel: pct(participators, value(bucket, "visitors")),
                    pct_communicated_in_channel: pct(communicators, value(bucket, "communicators")),
                };
            })
            .filter((row) => row.participators || row.messages_sent || row.speaking_minutes),
    );
};

const engagement = ({ buckets }: Context) =>
    buckets.map((bucket) => {
        const communicators = value(bucket, "communicators");
        const messages = value(bucket, "messages");
        return {
            ...stamp(bucket),
            visitors: value(bucket, "visitors"),
            communicators,
            pct_communicators: pct(communicators, value(bucket, "visitors")),
            messages,
            messages_per_communicator: communicators ? Math.round((messages / communicators) * 100) / 100 : 0,
            speaking_minutes: Math.round(value(bucket, "voice_seconds") / 60),
            voice_users: value(bucket, "voice_users"),
        };
    });

const reports: Record<string, (context: Context) => unknown[] | Promise<unknown[]>> = {
    "/overview": engagement,
    "/engagement/overview": engagement,
    "/engagement/base": engagement,
    "/engagement/text-channels": (context) => channelRows(context, false),
    "/engagement/voice-channels": (context) => channelRows(context, true),
    "/growth-activation/overview": ({ buckets }) =>
        buckets.map((bucket) => ({ ...stamp(bucket), new_members: value(bucket, "joins"), new_communicators: value(bucket, "new_communicators") })),
    "/growth-activation/joins": ({ buckets }) => buckets.map((bucket) => ({ ...stamp(bucket), joins: value(bucket, "joins") })),
    "/growth-activation/leavers": ({ buckets }) =>
        buckets.flatMap((bucket) =>
            LEAVER_TENURE_LABELS.map((label, index) => ({ ...stamp(bucket), days_in_guild: label, leavers: value(bucket, "leaves", `${index}`) })).filter((row) => row.leavers),
        ),
    "/growth-activation/joins-by-source": ({ buckets }) =>
        buckets.map((bucket) => {
            const row: Record<string, unknown> = {
                ...stamp(bucket),
                discovery_joins: 0,
                invites: 0,
                vanity_joins: 0,
                hubs_joins: 0,
                bot_joins: 0,
                integration_joins: 0,
                other_joins: 0,
            };
            let counted = 0;
            for (const [source, count] of Object.entries(bucket.metrics.joins_source ?? {})) {
                const field = JOIN_SOURCES[source] ?? "other_joins";
                row[field] = (row[field] as number) + count;
                counted += count;
            }
            const total = Math.max(value(bucket, "joins"), counted);
            row.other_joins = (row.other_joins as number) + total - counted;
            row.total_joins = total;
            return row;
        }),
    "/growth-activation/joins-by-invite-link": ({ buckets }) =>
        buckets.flatMap((bucket) =>
            Object.entries(bucket.metrics.joins_invite ?? {})
                .filter(([, joins]) => joins > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([invite_link, joins]) => ({ ...stamp(bucket), invite_link, joins })),
        ),
    "/growth-activation/activation": ({ buckets }) =>
        buckets.map((bucket) => ({ ...stamp(bucket), new_members: value(bucket, "joins"), pct_communicated: pct(value(bucket, "new_communicators"), value(bucket, "joins")) })),
    "/growth-activation/retention": ({ buckets }) =>
        buckets.map((bucket) => {
            const cohort = value(bucket, "retained_joins");
            const row: Record<string, unknown> = { ...stamp(bucket), new_members: value(bucket, "joins") };
            if (bucket.metrics.retained && cohort > 0) row.pct_retained = pct(value(bucket, "retained"), cohort);
            return row;
        }),
    "/growth-activation/membership": ({ buckets }) =>
        buckets.filter((bucket) => bucket.metrics.members).map((bucket) => ({ ...stamp(bucket), total_membership: value(bucket, "members") })),
};

for (const [path, build] of Object.entries(reports))
    router.get(path, route({ permission: "VIEW_GUILD_INSIGHTS" }), async (req: Request, res: Response) => {
        const { guild_id } = req.params as { guild_id: string };
        const date = (input: unknown) => (typeof input === "string" && input ? new Date(input) : null);
        const interval = Number(req.query.interval ?? InsightsInterval.DAILY);
        const buckets = await GuildInsights.report(guild_id, date(req.query.start), date(req.query.end), Number.isNaN(interval) ? InsightsInterval.DAILY : interval);
        res.json(await build({ guildId: guild_id, buckets }));
    });

export default router;
