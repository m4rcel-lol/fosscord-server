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

import { AuditLog, Ban, Guild, GuildInsights, Member, Message, User } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, FieldErrors, GuildBanAddEvent, GuildDeleteEvent, GuildMemberRemoveEvent, MessageDeleteBulkEvent, Snowflake } from "@spacebar/util";
import { AuditLogEvents, PublicUserProjection } from "@spacebar/schemas";
import { In, MoreThan } from "typeorm";

export const MAX_BAN_DELETE_SECONDS = 604800;

export function banDeleteSeconds(body: { delete_message_seconds?: unknown; delete_message_days?: unknown }) {
    const seconds = body.delete_message_seconds != null ? Number(body.delete_message_seconds) : body.delete_message_days != null ? Number(body.delete_message_days) * 86400 : 0;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_BAN_DELETE_SECONDS)
        throw FieldErrors({
            [body.delete_message_seconds != null ? "delete_message_seconds" : "delete_message_days"]: {
                code: "NUMBER_TYPE_MAX",
                message: body.delete_message_seconds != null ? "int value should be less than or equal to 604800." : "int value should be less than or equal to 7.",
            },
        });
    return Math.floor(seconds);
}

const highestPosition = (member: Member | null | undefined, guild_id: string) =>
    Math.max(0, ...(member?.roles ?? []).filter((role) => role.id !== guild_id).map((role) => role.position));

export async function bannableUsers(guild_id: string, actor_id: string, target_ids: string[]) {
    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, owner_id: true } });
    const candidates = target_ids.filter((id) => id !== guild.owner_id && (guild.owner_id === actor_id || id !== actor_id));
    if (guild.owner_id === actor_id || !candidates.length) return candidates;
    const members = await Member.find({ where: { guild_id, id: In([actor_id, ...candidates]) }, relations: { roles: true } });
    const byId = new Map(members.map((member) => [member.id, member]));
    const actorHighest = highestPosition(byId.get(actor_id), guild_id);
    return candidates.filter((id) => !byId.has(id) || highestPosition(byId.get(id), guild_id) < actorHighest);
}

export async function banHierarchy(guild_id: string, actor_id: string) {
    return async (target_id: string) => (await bannableUsers(guild_id, actor_id, [target_id])).length > 0;
}

async function deleteRecentMessages(guild_id: string, user_ids: string[], seconds: number) {
    if (!seconds || !user_ids.length) return;
    const messages = await Message.find({
        where: { guild_id, author_id: In(user_ids), timestamp: MoreThan(new Date(Date.now() - seconds * 1000)) },
        select: { id: true, channel_id: true },
    });
    if (!messages.length) return;
    await Message.delete(messages.map((message) => message.id));
    for (const [channel_id, list] of Map.groupBy(messages, (message) => message.channel_id!))
        await emitEvent({ event: "MESSAGE_DELETE_BULK", channel_id, data: { ids: list.map((m) => m.id), channel_id, guild_id } } satisfies MessageDeleteBulkEvent);
}

export async function banUsers(opts: { guild_id: string; user_ids: string[]; executor_id: string; reason?: string; delete_message_seconds: number; ip?: string }) {
    const { guild_id, executor_id, reason, ip, delete_message_seconds } = opts;
    const user_ids = [...new Set(opts.user_ids)];
    if (!user_ids.length) return { banned: [], unknown: [] };
    const [users, existing, members] = await Promise.all([
        User.find({ where: { id: In(user_ids) }, select: Object.fromEntries(PublicUserProjection.map((key) => [key, true])) }),
        Ban.find({ where: { guild_id, user_id: In(user_ids) }, select: { id: true, user_id: true } }),
        Member.find({ where: { guild_id, id: In(user_ids) }, select: { id: true, guild_id: true, joined_at: true } }),
    ]);
    const known = new Set(users.map((user) => user.id));
    const already = new Set(existing.map((ban) => ban.user_id));
    const targets = users.filter((user) => !already.has(user.id));
    const unknown = user_ids.filter((id) => !known.has(id));
    if (!targets.length) return { banned: [], unknown };

    const targetIds = new Set(targets.map((user) => user.id));
    const leaving = members.filter((member) => targetIds.has(member.id));
    const bots = new Set(targets.filter((user) => user.bot).map((user) => user.id));
    const humans = leaving.filter((member) => !bots.has(member.id));

    await Ban.insert(targets.map((user) => ({ id: Snowflake.generate(), user_id: user.id, guild_id, executor_id, reason, ip })));
    for (const member of leaving.filter((member) => bots.has(member.id))) await Member.removeFromGuild(member.id, guild_id);
    if (humans.length) {
        await Member.delete({ guild_id, id: In(humans.map((member) => member.id)) });
        await Guild.decrement({ id: guild_id }, "member_count", humans.length);
        GuildInsights.recordLeave(guild_id, ...humans.map((member) => member.joined_at));
    }
    await deleteRecentMessages(guild_id, [...targetIds], delete_message_seconds);
    await AuditLog.logMany(
        targets.map((user) => ({
            guild_id,
            user_id: executor_id,
            action_type: AuditLogEvents.MEMBER_BAN_ADD,
            target_id: user.id,
            reason,
            options: delete_message_seconds ? { delete_member_days: String(Math.round(delete_message_seconds / 86400)) } : undefined,
        })),
    );
    const publicUsers = new Map(targets.map((user) => [user.id, user.toPublicUser()]));
    await Promise.all([
        ...humans.flatMap((member) => [
            emitEvent({ event: "GUILD_DELETE", data: { id: guild_id }, user_id: member.id } satisfies GuildDeleteEvent),
            emitEvent({ event: "GUILD_MEMBER_REMOVE", data: { guild_id, user: publicUsers.get(member.id)! }, guild_id } satisfies GuildMemberRemoveEvent),
        ]),
        ...targets.map((user) =>
            emitEvent({
                event: "GUILD_BAN_ADD",
                data: { guild_id, user: publicUsers.get(user.id)!, delete_message_secs: delete_message_seconds },
                guild_id,
            } satisfies GuildBanAddEvent),
        ),
    ]);
    return { banned: [...targetIds], unknown };
}

export async function banUser(opts: { guild_id: string; user_id: string; executor_id: string; reason?: string; delete_message_seconds: number; ip?: string }) {
    const { banned, unknown } = await banUsers({ ...opts, user_ids: [opts.user_id] });
    if (unknown.length) throw DiscordApiErrors.UNKNOWN_USER;
    return banned.length > 0;
}
