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

import { Member, Recipient, Relationship, Session, User } from "@spacebar/database";
import { Activity, emitEvent, GuildMemberUpdateEvent, Presence, PresenceUpdateEvent, SessionsReplace } from "@spacebar/util";
import { ClientStatus, PublicStatus, PublicUser, RelationshipType } from "@spacebar/schemas";
import { In, Not } from "typeorm";

export function getMostRelevantSession(sessions: Session[]) {
    const statusMap = {
        online: 0,
        idle: 1,
        dnd: 2,
        invisible: 3,
        offline: 4,
        unknown: 5,
    };
    // sort sessions by relevance
    sessions = sessions.sort((a, b) => statusMap[a.status] - statusMap[b.status] + ((a.activities?.length ?? 0) - (b.activities?.length ?? 0)) * 2);

    return sessions[0];
}

export async function distributePresenceUpdate(userId: string, data: PresenceUpdateEvent) {
    let relationships: Relationship[] | undefined = await Relationship.find({
        where: { from_id: userId, type: RelationshipType.FRIEND },
        select: { from_id: true, to_id: true },
    });
    for (const rel of relationships)
        await emitEvent({
            ...data,
            user_id: rel.to_id,
        });
    // noinspection JSUnusedAssignment - drop array ref
    relationships = undefined;

    let memberGuildIds: string[] | undefined = (
        await Member.find({
            where: { id: userId },
            select: { guild_id: true },
        })
    ).map((x) => x.guild_id);
    for (const rel of memberGuildIds)
        await emitEvent({
            ...data,
            guild_id: rel,
        });
    // noinspection JSUnusedAssignment - drop array ref
    memberGuildIds = undefined;

    const recipients = await Recipient.find({ where: { user_id: userId, closed: false }, relations: { channel: true } });
    for (const recipient of recipients) {
        const otherRecipients = await Recipient.find({ where: { user_id: Not(userId), channel_id: recipient.channel_id } });
        for (const otherRcpt of otherRecipients) {
            if (otherRcpt.closed) continue;
            await emitEvent({
                ...data,
                user_id: otherRcpt.user_id,
            });
        }
    }
}

export const PRESENCE_STALE_AFTER_MS = 90 * 1000;

export type PresenceSession = Pick<Session, "user_id" | "status" | "activities" | "client_status" | "client_info" | "last_seen">;

export interface AggregatedPresence {
    status: PublicStatus;
    activities: Activity[];
    client_status: ClientStatus;
    processed_at_timestamp: number;
}

const PresencePriority: Record<string, number> = { dnd: 0, online: 1, idle: 2 };
const ClientPlatforms = ["desktop", "mobile", "web", "embedded", "vr"] as const;
export type ClientPlatform = (typeof ClientPlatforms)[number];

export function getClientPlatform(properties?: { browser?: string; $browser?: string; os?: string; $os?: string }): ClientPlatform {
    const browser = (properties?.browser ?? properties?.$browser ?? "").toLowerCase();
    const os = (properties?.os ?? properties?.$os ?? "").toLowerCase();
    if (browser.includes("android") || browser.includes("ios") || os === "android" || os === "ios") return "mobile";
    if (browser === "discord client" || browser.includes("electron")) return "desktop";
    if (browser.includes("embedded")) return "embedded";
    if (browser.includes("vr")) return "vr";
    return "web";
}

const ActivityKeys = [
    "name",
    "type",
    "url",
    "created_at",
    "timestamps",
    "application_id",
    "parent_application_id",
    "details",
    "details_url",
    "state",
    "state_url",
    "emoji",
    "party",
    "assets",
    "secrets",
    "instance",
    "flags",
    "id",
    "sync_id",
    "metadata",
    "session_id",
    "platform",
    "supported_platforms",
    "status_display_type",
    "buttons",
];

export function sanitizeActivities(activities: unknown, previous: Activity[] = []): Activity[] {
    if (!Array.isArray(activities)) return [];
    return activities
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof x.name === "string" && Number.isInteger(Number(x.type)))
        .slice(0, 10)
        .map((x) => {
            const activity = Object.fromEntries(ActivityKeys.filter((key) => x[key] !== undefined).map((key) => [key, x[key]]));
            activity.type = Number(activity.type);
            activity.created_at ??= previous.find((p) => p.type === activity.type && p.name === activity.name)?.created_at ?? Date.now();
            return activity as unknown as Activity;
        });
}

export function isSessionConnected(session: PresenceSession, now = Date.now()) {
    if (!session.status || session.status === "offline") return false;
    return (session.last_seen?.getTime() ?? 0) > now - PRESENCE_STALE_AFTER_MS;
}

export function aggregatePresence(sessions: PresenceSession[]): AggregatedPresence {
    const now = Date.now();
    const visible = sessions.filter((s) => isSessionConnected(s, now) && s.status in PresencePriority);
    if (!visible.length) return { status: "offline", activities: [], client_status: {}, processed_at_timestamp: Date.now() };

    const best = (a: string | undefined, b: string) => (a === undefined || PresencePriority[b] < PresencePriority[a] ? b : a);
    let status: string | undefined;
    const client_status: ClientStatus = {};
    const activities: Activity[] = [];
    const seenActivities = new Set<string>();

    for (const session of visible) {
        status = best(status, session.status);
        const platform = ClientPlatforms.find((x) => x === session.client_info?.platform) ?? "web";
        client_status[platform] = best(client_status[platform], session.status);
        for (const activity of session.activities ?? []) {
            const key = activity.type === 4 ? "custom" : `${activity.type}:${activity.application_id ?? activity.name}`;
            if (seenActivities.has(key)) continue;
            seenActivities.add(key);
            activities.push(activity);
        }
    }

    return { status: status as PublicStatus, activities, client_status, processed_at_timestamp: Date.now() };
}

export async function getUserPresences(userIds: string[]) {
    const result = new Map<string, AggregatedPresence>();
    if (!userIds.length) return result;
    const sessions = await Session.find({
        where: { user_id: In(userIds), is_admin_session: false, status: Not("offline") },
        select: { user_id: true, status: true, activities: true, client_status: true, client_info: true, last_seen: true },
    });
    const byUser = new Map<string, Session[]>();
    for (const session of sessions) byUser.set(session.user_id, [...(byUser.get(session.user_id) ?? []), session]);
    for (const [userId, userSessions] of byUser) {
        const presence = aggregatePresence(userSessions);
        if (presence.status !== "offline") result.set(userId, presence);
    }
    return result;
}

export async function getUserPresence(userId: string): Promise<AggregatedPresence> {
    return (await getUserPresences([userId])).get(userId) ?? { status: "offline", activities: [], client_status: {}, processed_at_timestamp: Date.now() };
}

export async function getConnectedSessions(userId: string) {
    const now = Date.now();
    return (await Session.find({ where: { user_id: userId, is_admin_session: false, status: Not("offline") } })).filter((x) => isSessionConnected(x, now));
}

export async function emitSessionsReplace(userId: string) {
    const sessions = await getConnectedSessions(userId);
    await emitEvent({ event: "SESSIONS_REPLACE", user_id: userId, data: sessions.map((x) => x.toPrivateGatewayDeviceInfo()) } satisfies SessionsReplace);
    return sessions;
}

export async function broadcastPresence(userId: string, user?: PublicUser) {
    const [presence, publicUser, friends, guilds, recipients] = await Promise.all([
        getUserPresence(userId),
        user ? Promise.resolve(user) : User.getPublicUser(userId),
        Relationship.find({ where: { from_id: userId, type: RelationshipType.FRIEND }, select: { to_id: true } }),
        Member.find({ where: { id: userId }, select: { guild_id: true } }),
        Recipient.find({ where: { user_id: userId, closed: false }, select: { channel_id: true } }),
    ]);

    const data: Presence = { user: publicUser, ...presence };
    await emitEvent({ event: "PRESENCE_UPDATE", user_id: userId, data } satisfies PresenceUpdateEvent);
    await Promise.all(guilds.map(({ guild_id }) => emitEvent({ event: "PRESENCE_UPDATE", guild_id, data: { ...data, guild_id } } satisfies PresenceUpdateEvent)));

    if (!recipients.length) return presence;
    const friendIds = new Set(friends.map((x) => x.to_id));
    const others = await Recipient.find({
        where: { channel_id: In(recipients.map((x) => x.channel_id)), user_id: Not(userId), closed: false },
        select: { user_id: true },
    });
    const dmUserIds = new Set(others.map((x) => x.user_id).filter((id) => !friendIds.has(id)));
    await Promise.all([...dmUserIds].map((id) => emitEvent({ event: "PRESENCE_UPDATE", user_id: id, data } satisfies PresenceUpdateEvent)));
    return presence;
}

export async function broadcastUserUpdate(userId: string) {
    const [user, members] = await Promise.all([User.getPublicUser(userId), Member.find({ where: { id: userId }, relations: { roles: true } })]);
    await Promise.all(
        members.map((member) =>
            emitEvent({
                event: "GUILD_MEMBER_UPDATE",
                guild_id: member.guild_id,
                data: { ...member.toPublicMember(), guild_id: member.guild_id, user, roles: member.roles.map((x) => x.id).filter((id) => id !== member.guild_id) },
            } satisfies GuildMemberUpdateEvent),
        ),
    );
    await broadcastPresence(userId, user);
}
