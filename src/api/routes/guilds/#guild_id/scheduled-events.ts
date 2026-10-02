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
import { In, IsNull, LessThan, MoreThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import {
    AuditLog,
    Channel,
    GuildScheduledEvent,
    GuildScheduledEventEntityType,
    GuildScheduledEventStatus,
    GuildScheduledEventUser,
    Member,
    ScheduledEvents,
    StageInstances,
} from "@spacebar/database";
import { DiscordApiErrors, FieldErrors, Snowflake, deleteFile, emitEvent, getPermission, handleFile } from "@spacebar/util";
import { AuditLogEvents, ChannelType } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const MAX_ACTIVE_EVENTS = 100;
const AUDITED_FIELDS = [
    "name",
    "description",
    "channel_id",
    "privacy_level",
    "status",
    "entity_type",
    "location",
    "image",
    "recurrence_rule",
    "scheduled_start_time",
    "scheduled_end_time",
];

type EventBody = {
    channel_id?: string | null;
    entity_metadata?: { location?: string | null } | null;
    name?: string;
    privacy_level?: number;
    scheduled_start_time?: string;
    scheduled_end_time?: string | null;
    description?: string | null;
    entity_type?: number;
    status?: number;
    image?: string | null;
    recurrence_rule?: Record<string, unknown> | null;
    auto_start?: boolean;
};

const fail = (field: string, message: string, code = "BASE_TYPE_INVALID"): never => {
    throw FieldErrors({ [field]: { code, message } });
};

const parseTime = (field: string, value: unknown) => {
    const date = typeof value === "string" ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) fail(field, "Invalid ISO8601 timestamp.", "DATE_TIME_TYPE_PARSE");
    return date as Date;
};

const auditView = (event: Partial<GuildScheduledEvent>) => ({
    ...event,
    location: event.entity_metadata?.location ?? null,
    scheduled_start_time: event.scheduled_start_time ? new Date(event.scheduled_start_time).toISOString() : null,
    scheduled_end_time: event.scheduled_end_time ? new Date(event.scheduled_end_time).toISOString() : null,
});

const findEvent = async (guildId: string, eventId: string) => {
    const event = await GuildScheduledEvent.findOne({ where: { id: eventId, guild_id: guildId }, relations: { creator: true } });
    if (!event) throw DiscordApiErrors.UNKNOWN_GUILD_SCHEDULED_EVENT;
    return event;
};

const canSee = async (userId: string, event: GuildScheduledEvent) => {
    if (!event.channel_id) return true;
    const permission = await getPermission(userId, event.guild_id, event.channel_id).catch(() => null);
    return !!permission?.has("VIEW_CHANNEL");
};

const findVisibleEvent = async (req: Request) => {
    const { guild_id, event_id } = req.params as { [key: string]: string };
    await Member.IsInGuildOrFail(req.user_id, guild_id);
    const event = await findEvent(guild_id, event_id);
    if (!(await canSee(req.user_id, event))) throw DiscordApiErrors.UNKNOWN_GUILD_SCHEDULED_EVENT;
    return event;
};

const assertCanManage = async (userId: string, guildId: string, event?: GuildScheduledEvent) => {
    const permission = await getPermission(userId, guildId);
    if (permission.has("MANAGE_EVENTS")) return;
    if (permission.has("CREATE_EVENTS") && (!event || event.creator_id === userId)) return;
    throw DiscordApiErrors.MISSING_PERMISSIONS.withParams(event ? "MANAGE_EVENTS" : "CREATE_EVENTS");
};

const applyBody = async (userId: string, guildId: string, body: EventBody, event: GuildScheduledEvent, creating: boolean) => {
    if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) fail("name", "Must be between 1 and 100 in length.", "BASE_TYPE_BAD_LENGTH");
        event.name = body.name.trim();
    }
    if (body.description !== undefined) {
        if (body.description !== null && (typeof body.description !== "string" || body.description.length > 1000))
            fail("description", "Must be 1000 or fewer in length.", "BASE_TYPE_MAX_LENGTH");
        event.description = body.description?.trim() || null;
    }
    if (body.privacy_level !== undefined) {
        if (body.privacy_level !== 2) fail("privacy_level", "Value must be one of {2}.", "BASE_TYPE_CHOICES");
        event.privacy_level = 2;
    }
    if (body.entity_type !== undefined) {
        if (![GuildScheduledEventEntityType.STAGE_INSTANCE, GuildScheduledEventEntityType.VOICE, GuildScheduledEventEntityType.EXTERNAL].includes(body.entity_type))
            fail("entity_type", "Value must be one of {1, 2, 3}.", "BASE_TYPE_CHOICES");
        event.entity_type = body.entity_type;
    }
    if (body.scheduled_start_time !== undefined) {
        const start = parseTime("scheduled_start_time", body.scheduled_start_time);
        if (
            (creating || start.getTime() !== new Date(event.scheduled_start_time).getTime()) &&
            start.getTime() < Date.now() - 60_000 &&
            event.status === GuildScheduledEventStatus.SCHEDULED
        )
            fail("scheduled_start_time", "Cannot schedule event in the past.", "GUILD_SCHEDULED_EVENT_SCHEDULE_PAST");
        event.scheduled_start_time = start;
    }
    if (body.scheduled_end_time !== undefined) event.scheduled_end_time = body.scheduled_end_time === null ? null : parseTime("scheduled_end_time", body.scheduled_end_time);
    if (body.entity_metadata !== undefined) {
        const location = body.entity_metadata?.location;
        if (location != null && (typeof location !== "string" || location.length > 100))
            fail("entity_metadata.location", "Must be between 1 and 100 in length.", "BASE_TYPE_BAD_LENGTH");
        event.entity_metadata = location ? { location: location.trim() } : null;
    }
    if (body.channel_id !== undefined) event.channel_id = body.channel_id || null;
    if (body.recurrence_rule !== undefined) event.recurrence_rule = body.recurrence_rule && typeof body.recurrence_rule === "object" ? body.recurrence_rule : null;
    if (body.auto_start !== undefined) event.auto_start = !!body.auto_start;

    if (!event.name) fail("name", "This field is required", "BASE_TYPE_REQUIRED");
    if (!event.entity_type) fail("entity_type", "This field is required", "BASE_TYPE_REQUIRED");
    if (!event.scheduled_start_time) fail("scheduled_start_time", "This field is required", "BASE_TYPE_REQUIRED");
    if (event.scheduled_end_time && new Date(event.scheduled_end_time).getTime() <= new Date(event.scheduled_start_time).getTime())
        fail("scheduled_end_time", "End time must be after the start time.", "GUILD_SCHEDULED_EVENT_END_BEFORE_START");

    if (event.entity_type === GuildScheduledEventEntityType.EXTERNAL) {
        event.channel_id = null;
        if (!event.entity_metadata?.location) fail("entity_metadata.location", "This field is required", "BASE_TYPE_REQUIRED");
        if (!event.scheduled_end_time) fail("scheduled_end_time", "This field is required", "BASE_TYPE_REQUIRED");
        return;
    }

    event.entity_metadata = null;
    if (!event.channel_id) fail("channel_id", "This field is required", "BASE_TYPE_REQUIRED");
    const channel = await Channel.findOne({ where: { id: event.channel_id!, guild_id: guildId }, select: { id: true, type: true } });
    const expected = event.entity_type === GuildScheduledEventEntityType.STAGE_INSTANCE ? ChannelType.GUILD_STAGE_VOICE : ChannelType.GUILD_VOICE;
    if (!channel || channel.type !== expected) fail("channel_id", "Invalid channel for this event type.", "CHANNEL_TYPE_INVALID");
    const permission = await getPermission(userId, guildId, channel!.id);
    if (!permission.has("VIEW_CHANNEL")) throw DiscordApiErrors.UNKNOWN_CHANNEL;
};

const publishUser = (row: GuildScheduledEventUser, type: "GUILD_SCHEDULED_EVENT_USER_ADD" | "GUILD_SCHEDULED_EVENT_USER_REMOVE") =>
    emitEvent({ event: type, guild_id: row.guild_id, data: { ...row.toJSON(), guild_id: row.guild_id } });

const rsvp = async (event: GuildScheduledEvent, userId: string, exceptionId: string | null, response: number) => {
    const existing = await GuildScheduledEventUser.findOne({
        where: { guild_scheduled_event_id: event.id, user_id: userId, guild_scheduled_event_exception_id: exceptionId ?? IsNull() },
    });
    const row =
        existing ??
        GuildScheduledEventUser.create({
            guild_scheduled_event_id: event.id,
            user_id: userId,
            guild_id: event.guild_id,
            guild_scheduled_event_exception_id: exceptionId,
        });
    row.response = response;
    await row.save();
    await publishUser(row, "GUILD_SCHEDULED_EVENT_USER_ADD");
    return row;
};

const listUsers = async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    const exceptionId = (req.params.exception_id as string | undefined) ?? null;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 100);
    const { before, after } = req.query as { before?: string; after?: string };
    const rows = await GuildScheduledEventUser.find({
        where: {
            guild_scheduled_event_id: event.id,
            guild_scheduled_event_exception_id: exceptionId ?? IsNull(),
            response: 1,
            ...(before ? { user_id: LessThan(before) } : after ? { user_id: MoreThan(after) } : {}),
        },
        relations: { user: true },
        order: { user_id: before ? "DESC" : "ASC" },
        take: limit,
    });
    const withMember = String(req.query.with_member) === "true";
    const members = withMember && rows.length ? await Member.find({ where: { guild_id: event.guild_id, id: In(rows.map((r) => r.user_id)) }, relations: { roles: true } }) : [];
    const memberMap = new Map(members.map((m) => [m.id, m]));
    res.json(
        rows.map((row) => {
            const member = memberMap.get(row.user_id);
            return {
                ...row.toJSON(),
                user: row.user?.toPublicUser(),
                ...(member ? { member: member.toPublicMember() } : {}),
            };
        }),
    );
};

router.get("/", route({ responses: { 200: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    await Member.IsInGuildOrFail(req.user_id, guild_id);
    const events = await ScheduledEvents.forGuilds([guild_id]);
    const visible = [];
    for (const event of events) if (await canSee(req.user_id, event)) visible.push(event);
    const withCount = String(req.query.with_user_count) === "true";
    const counts = withCount ? await ScheduledEvents.userCounts(visible.map((e) => e.id)) : new Map<string, number>();
    res.json(visible.map((event) => event.toJSON(withCount ? (counts.get(event.id) ?? 0) : undefined)));
});

router.post("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    await Member.IsInGuildOrFail(req.user_id, guild_id);
    await assertCanManage(req.user_id, guild_id);
    const body = (req.body ?? {}) as EventBody;
    if (body.name === undefined) fail("name", "This field is required", "BASE_TYPE_REQUIRED");
    if (body.scheduled_start_time === undefined) fail("scheduled_start_time", "This field is required", "BASE_TYPE_REQUIRED");
    if (body.entity_type === undefined) fail("entity_type", "This field is required", "BASE_TYPE_REQUIRED");

    const open = await GuildScheduledEvent.count({ where: { guild_id, status: In([GuildScheduledEventStatus.SCHEDULED, GuildScheduledEventStatus.ACTIVE]) } });
    if (open >= MAX_ACTIVE_EVENTS) throw FieldErrors({ guild_id: { code: "MAX_GUILD_SCHEDULED_EVENTS", message: "Maximum number of scheduled events reached (100)." } });

    const event = GuildScheduledEvent.create({
        id: Snowflake.generate(),
        guild_id,
        creator_id: req.user_id,
        status: GuildScheduledEventStatus.SCHEDULED,
        privacy_level: 2,
        exceptions: [],
        auto_start: false,
        description: null,
        image: null,
        entity_id: null,
        entity_metadata: null,
        recurrence_rule: null,
        scheduled_end_time: null,
        channel_id: null,
    });
    await applyBody(req.user_id, guild_id, body, event, true);
    if (body.image) event.image = (await handleFile(`/guild-events/${event.id}`, body.image)) ?? null;
    await event.save();
    const saved = await findEvent(guild_id, event.id);

    await ScheduledEvents.publish(saved, "GUILD_SCHEDULED_EVENT_CREATE");
    await rsvp(saved, req.user_id, null, 1);
    await AuditLog.log({
        guild_id,
        user_id: req.user_id,
        action_type: AuditLogEvents.GUILD_SCHEDULED_EVENT_CREATE,
        target_id: saved.id,
        changes: AuditLog.diff({}, auditView(saved), AUDITED_FIELDS),
        reason: req.headers["x-audit-log-reason"] as string | undefined,
    });
    res.json(await ScheduledEvents.serialize(saved));
});

router.get("/:event_id/users/counts", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    if (!/^\d+$/.test(req.params.event_id as string)) return res.json({ guild_scheduled_event_count: 0, guild_scheduled_event_exception_counts: {} });
    const event = await findVisibleEvent(req);
    const raw = req.query.guild_scheduled_event_exception_ids;
    const exceptionIds = (Array.isArray(raw) ? raw : raw ? String(raw).split(",") : []).map(String).filter(Boolean).slice(0, 10);
    const total = (await ScheduledEvents.userCounts([event.id])).get(event.id) ?? 0;
    const exceptionCounts: Record<string, number> = {};
    if (exceptionIds.length) {
        const series = await GuildScheduledEventUser.find({
            where: { guild_scheduled_event_id: event.id, guild_scheduled_event_exception_id: IsNull(), response: 1 },
            select: { user_id: true },
        });
        const overrides = await GuildScheduledEventUser.find({
            where: { guild_scheduled_event_id: event.id, guild_scheduled_event_exception_id: In(exceptionIds) },
            select: { user_id: true, guild_scheduled_event_exception_id: true, response: true },
        });
        for (const id of exceptionIds) {
            const interested = new Set(series.map((row) => row.user_id));
            for (const row of overrides.filter((o) => o.guild_scheduled_event_exception_id === id)) {
                if (row.response === 1) interested.add(row.user_id);
                else interested.delete(row.user_id);
            }
            exceptionCounts[id] = interested.size;
        }
    }
    res.json({ guild_scheduled_event_count: total, guild_scheduled_event_exception_counts: exceptionCounts });
});

router.get("/:event_id/users", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), listUsers);
router.get("/:event_id/:exception_id/users", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), listUsers);

const putMe = async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    if ([GuildScheduledEventStatus.COMPLETED, GuildScheduledEventStatus.CANCELED].includes(event.status)) throw DiscordApiErrors.UNKNOWN_GUILD_SCHEDULED_EVENT;
    const exceptionId = (req.params.exception_id as string | undefined) ?? null;
    const response = Number(req.body?.response ?? 1) === 0 ? 0 : 1;
    const row = await rsvp(event, req.user_id, exceptionId, response);
    res.json(row.toJSON());
};

const deleteMe = async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    const exceptionId = (req.params.exception_id as string | undefined) ?? null;
    const row = await GuildScheduledEventUser.findOne({
        where: { guild_scheduled_event_id: event.id, user_id: req.user_id, guild_scheduled_event_exception_id: exceptionId ?? IsNull() },
    });
    if (row) {
        await GuildScheduledEventUser.delete({ id: row.id });
        await publishUser(row, "GUILD_SCHEDULED_EVENT_USER_REMOVE");
    }
    res.sendStatus(204);
};

router.put("/:event_id/users/@me", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), putMe);
router.delete("/:event_id/users/@me", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), deleteMe);
router.put("/:event_id/:exception_id/users/@me", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), putMe);
router.delete("/:event_id/:exception_id/users/@me", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), deleteMe);

router.post(
    "/:event_id/exceptions",
    route({ responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } } }),
    async (req: Request, res: Response) => {
        const event = await findVisibleEvent(req);
        await assertCanManage(req.user_id, event.guild_id, event);
        if (!event.recurrence_rule) fail("recurrence_rule", "Event is not recurring.", "GUILD_SCHEDULED_EVENT_NOT_RECURRING");
        const { original_scheduled_start_time, scheduled_start_time, scheduled_end_time, is_canceled } = req.body ?? {};
        const original = parseTime("original_scheduled_start_time", original_scheduled_start_time).toISOString();
        const existing = event.exceptions.find((e) => e.original_scheduled_start_time === original);
        const exception = {
            event_exception_id: existing?.event_exception_id ?? Snowflake.generate(),
            event_id: event.id,
            guild_id: event.guild_id,
            original_scheduled_start_time: original,
            scheduled_start_time: scheduled_start_time ? parseTime("scheduled_start_time", scheduled_start_time).toISOString() : null,
            scheduled_end_time: scheduled_end_time ? parseTime("scheduled_end_time", scheduled_end_time).toISOString() : null,
            is_canceled: !!is_canceled,
        };
        event.exceptions = [...event.exceptions.filter((e) => e.event_exception_id !== exception.event_exception_id), exception];
        await event.save();
        await emitEvent({ event: existing ? "GUILD_SCHEDULED_EVENT_EXCEPTION_UPDATE" : "GUILD_SCHEDULED_EVENT_EXCEPTION_CREATE", guild_id: event.guild_id, data: exception });
        res.json(exception);
    },
);

router.patch("/:event_id/exceptions/:exception_id", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    await assertCanManage(req.user_id, event.guild_id, event);
    const exception = event.exceptions.find((e) => e.event_exception_id === req.params.exception_id);
    if (!exception) throw DiscordApiErrors.UNKNOWN_GUILD_SCHEDULED_EVENT;
    const { scheduled_start_time, scheduled_end_time, is_canceled } = req.body ?? {};
    if (scheduled_start_time !== undefined) exception.scheduled_start_time = scheduled_start_time ? parseTime("scheduled_start_time", scheduled_start_time).toISOString() : null;
    if (scheduled_end_time !== undefined) exception.scheduled_end_time = scheduled_end_time ? parseTime("scheduled_end_time", scheduled_end_time).toISOString() : null;
    if (is_canceled !== undefined) exception.is_canceled = !!is_canceled;
    event.exceptions = [...event.exceptions];
    await event.save();
    await emitEvent({ event: "GUILD_SCHEDULED_EVENT_EXCEPTION_UPDATE", guild_id: event.guild_id, data: exception });
    res.json(exception);
});

router.delete("/:event_id/exceptions/:exception_id", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    await assertCanManage(req.user_id, event.guild_id, event);
    const exception = event.exceptions.find((e) => e.event_exception_id === req.params.exception_id);
    if (!exception) throw DiscordApiErrors.UNKNOWN_GUILD_SCHEDULED_EVENT;
    event.exceptions = event.exceptions.filter((e) => e !== exception);
    await event.save();
    await emitEvent({ event: "GUILD_SCHEDULED_EVENT_EXCEPTION_DELETE", guild_id: event.guild_id, data: exception });
    res.sendStatus(204);
});

router.get("/:event_id", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    if (String(req.query.with_user_count) === "true") return res.json(await ScheduledEvents.serialize(event));
    res.json(event.toJSON());
});

router.patch("/:event_id", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    await assertCanManage(req.user_id, event.guild_id, event);
    if ([GuildScheduledEventStatus.COMPLETED, GuildScheduledEventStatus.CANCELED].includes(event.status))
        fail("status", "Cannot modify a completed or canceled event.", "GUILD_SCHEDULED_EVENT_INVALID_STATUS");
    const body = (req.body ?? {}) as EventBody;
    const before = auditView({ ...event });

    const status = (body.status !== undefined ? Number(body.status) : event.status) as GuildScheduledEventStatus;
    const allowed: Record<number, number[]> = {
        [GuildScheduledEventStatus.SCHEDULED]: [GuildScheduledEventStatus.SCHEDULED, GuildScheduledEventStatus.ACTIVE, GuildScheduledEventStatus.CANCELED],
        [GuildScheduledEventStatus.ACTIVE]: [GuildScheduledEventStatus.ACTIVE, GuildScheduledEventStatus.COMPLETED],
    };
    if (!allowed[event.status]?.includes(status)) fail("status", "Invalid status transition.", "GUILD_SCHEDULED_EVENT_INVALID_STATUS");

    await applyBody(req.user_id, event.guild_id, body, event, false);
    if (body.image !== undefined) {
        if (event.image && body.image === null) await deleteFile(`/guild-events/${event.id}/${event.image}`).catch(() => undefined);
        event.image = body.image ? ((await handleFile(`/guild-events/${event.id}`, body.image)) ?? event.image) : null;
    }
    await event.save();

    const stage = status !== event.status && event.entity_type === GuildScheduledEventEntityType.STAGE_INSTANCE && event.channel_id ? event.channel_id : null;
    if (stage && status === GuildScheduledEventStatus.ACTIVE && !(await StageInstances.get(stage)))
        await StageInstances.create(event.guild_id, stage, event.name, event.privacy_level, event.id);
    if (stage && status === GuildScheduledEventStatus.COMPLETED) await StageInstances.delete(stage);

    const fresh = await findEvent(event.guild_id, event.id);
    const data =
        fresh.status === event.status && status !== event.status
            ? await ScheduledEvents.setStatus(fresh, status)
            : await ScheduledEvents.publish(fresh, "GUILD_SCHEDULED_EVENT_UPDATE");

    await AuditLog.log({
        guild_id: event.guild_id,
        user_id: req.user_id,
        action_type: AuditLogEvents.GUILD_SCHEDULED_EVENT_UPDATE,
        target_id: event.id,
        changes: AuditLog.diff(before, auditView({ ...fresh, status: data.status }), AUDITED_FIELDS),
        reason: req.headers["x-audit-log-reason"] as string | undefined,
    });
    res.json(data);
});

router.delete("/:event_id", route({ responses: { 204: {}, 403: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const event = await findVisibleEvent(req);
    await assertCanManage(req.user_id, event.guild_id, event);
    const data = await ScheduledEvents.serialize(event);
    await GuildScheduledEvent.delete({ id: event.id });
    if (event.image) await deleteFile(`/guild-events/${event.id}/${event.image}`).catch(() => undefined);
    await emitEvent({ event: "GUILD_SCHEDULED_EVENT_DELETE", guild_id: event.guild_id, data });
    await AuditLog.log({
        guild_id: event.guild_id,
        user_id: req.user_id,
        action_type: AuditLogEvents.GUILD_SCHEDULED_EVENT_DELETE,
        target_id: event.id,
        changes: AuditLog.diff(auditView(event), {}, AUDITED_FIELDS),
        reason: req.headers["x-audit-log-reason"] as string | undefined,
    });
    res.sendStatus(204);
});

export default router;
