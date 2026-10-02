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

import { In, IsNull, LessThanOrEqual, Not } from "typeorm";
import { emitEvent } from "@spacebar/util/util";
import { GuildScheduledEvent, GuildScheduledEventEntityType, GuildScheduledEventStatus, GuildScheduledEventUser } from "../entities/GuildScheduledEvent";

const DAY = 86_400_000;

type RecurrenceRule = {
    end?: string | null;
    frequency?: number;
    interval?: number;
    by_weekday?: number[] | null;
    by_n_weekday?: { n: number; day: number }[] | null;
    count?: number | null;
};

const weekday = (date: Date) => (date.getUTCDay() + 6) % 7;

const nthWeekdayOfMonth = (year: number, month: number, n: number, day: number, template: Date) => {
    const first = new Date(Date.UTC(year, month, 1, template.getUTCHours(), template.getUTCMinutes(), template.getUTCSeconds()));
    const offset = (day - weekday(first) + 7) % 7;
    const result = new Date(first.getTime() + (offset + (n - 1) * 7) * DAY);
    return result.getUTCMonth() === month ? result : null;
};

const step = (from: Date, rule: RecurrenceRule) => {
    const interval = Math.max(1, rule.interval ?? 1);
    switch (rule.frequency) {
        case 0: {
            const next = new Date(from);
            next.setUTCFullYear(next.getUTCFullYear() + interval);
            return next;
        }
        case 1: {
            const nth = rule.by_n_weekday?.[0];
            for (let months = interval; months <= interval * 24; months += interval) {
                const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
                if (!nth) {
                    const next = new Date(from);
                    next.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), from.getUTCDate());
                    if (next.getUTCMonth() === target.getUTCMonth()) return next;
                    continue;
                }
                const next = nthWeekdayOfMonth(target.getUTCFullYear(), target.getUTCMonth(), nth.n, nth.day, from);
                if (next) return next;
            }
            return null;
        }
        case 2:
            return new Date(from.getTime() + 7 * interval * DAY);
        case 3: {
            const days = rule.by_weekday?.length ? new Set(rule.by_weekday) : null;
            let next = new Date(from.getTime() + interval * DAY);
            while (days && !days.has(weekday(next))) next = new Date(next.getTime() + DAY);
            return next;
        }
        default:
            return null;
    }
};

export class ScheduledEvents {
    private static sweeper?: NodeJS.Timeout;

    static async userCounts(eventIds: string[]) {
        if (!eventIds.length) return new Map<string, number>();
        const rows = await GuildScheduledEventUser.createQueryBuilder("u")
            .select("u.guild_scheduled_event_id", "id")
            .addSelect("COUNT(*)", "count")
            .where({ guild_scheduled_event_id: In(eventIds), guild_scheduled_event_exception_id: IsNull(), response: 1 })
            .groupBy("u.guild_scheduled_event_id")
            .getRawMany<{ id: string; count: string }>();
        return new Map(rows.map((row) => [String(row.id), Number(row.count)]));
    }

    static async serialize(event: GuildScheduledEvent) {
        const counts = await ScheduledEvents.userCounts([event.id]);
        return event.toJSON(counts.get(event.id) ?? 0);
    }

    static async forGuilds(guildIds: string[]) {
        if (!guildIds.length) return [];
        return GuildScheduledEvent.find({
            where: { guild_id: In(guildIds), status: In([GuildScheduledEventStatus.SCHEDULED, GuildScheduledEventStatus.ACTIVE]) },
            relations: { creator: true },
            order: { scheduled_start_time: "ASC" },
        });
    }

    static async publish(event: GuildScheduledEvent, type: "GUILD_SCHEDULED_EVENT_CREATE" | "GUILD_SCHEDULED_EVENT_UPDATE" | "GUILD_SCHEDULED_EVENT_DELETE") {
        const data = await ScheduledEvents.serialize(event);
        await emitEvent({ event: type, guild_id: event.guild_id, data });
        return data;
    }

    static async setStatus(event: GuildScheduledEvent, status: GuildScheduledEventStatus, changes: Partial<GuildScheduledEvent> = {}) {
        Object.assign(event, changes, { status });
        if (status === GuildScheduledEventStatus.COMPLETED && event.recurrence_rule) {
            const rescheduled = ScheduledEvents.nextOccurrence(event);
            if (rescheduled) Object.assign(event, rescheduled, { status: GuildScheduledEventStatus.SCHEDULED, entity_id: null });
        }
        await event.save();
        return ScheduledEvents.publish(event, "GUILD_SCHEDULED_EVENT_UPDATE");
    }

    static nextOccurrence(event: GuildScheduledEvent) {
        const rule = event.recurrence_rule as RecurrenceRule | null;
        if (!rule) return null;
        const start = new Date(event.scheduled_start_time);
        const duration = event.scheduled_end_time ? new Date(event.scheduled_end_time).getTime() - start.getTime() : null;
        const end = rule.end ? new Date(rule.end).getTime() : Infinity;
        const canceled = new Set(event.exceptions.filter((e) => e.is_canceled).map((e) => new Date(e.original_scheduled_start_time).getTime()));
        let next: Date | null = start;
        for (let i = 0; i < 1000 && next; i++) {
            next = step(next, rule);
            if (!next || next.getTime() > end) return null;
            if (next.getTime() > Date.now() && !canceled.has(next.getTime())) break;
        }
        if (!next) return null;
        return { scheduled_start_time: next, scheduled_end_time: duration !== null ? new Date(next.getTime() + duration) : null };
    }

    static async stageStarted(eventId: string | null | undefined, guildId: string, stageInstanceId: string) {
        if (!eventId) return;
        const event = await GuildScheduledEvent.findOne({ where: { id: eventId, guild_id: guildId }, relations: { creator: true } });
        if (!event || event.status !== GuildScheduledEventStatus.SCHEDULED) return;
        await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.ACTIVE, { entity_id: stageInstanceId });
    }

    static async channelEnded(channelId: string) {
        const events = await GuildScheduledEvent.find({
            where: { channel_id: channelId, status: GuildScheduledEventStatus.ACTIVE, entity_type: Not(GuildScheduledEventEntityType.EXTERNAL) },
            relations: { creator: true },
        });
        for (const event of events) await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.COMPLETED);
    }

    static async sweep() {
        const now = new Date();
        const starting = await GuildScheduledEvent.find({
            where: [
                { status: GuildScheduledEventStatus.SCHEDULED, entity_type: GuildScheduledEventEntityType.EXTERNAL, scheduled_start_time: LessThanOrEqual(now) },
                { status: GuildScheduledEventStatus.SCHEDULED, auto_start: true, scheduled_start_time: LessThanOrEqual(now) },
            ],
            relations: { creator: true },
        });
        for (const event of starting) await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.ACTIVE);
        const ending = await GuildScheduledEvent.find({
            where: { status: GuildScheduledEventStatus.ACTIVE, entity_type: GuildScheduledEventEntityType.EXTERNAL, scheduled_end_time: LessThanOrEqual(now) },
            relations: { creator: true },
        });
        for (const event of ending) await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.COMPLETED);
    }

    static startSweeper(intervalMs = 30_000) {
        ScheduledEvents.sweeper ??= setInterval(() => void ScheduledEvents.sweep().catch((e) => console.error("[ScheduledEvents] sweep failed", e)), intervalMs).unref();
    }
}
