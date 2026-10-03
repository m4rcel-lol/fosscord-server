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

import { AuditLog, Ban, Guild, Member, Message, User } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, FieldErrors, GuildBanAddEvent, MessageDeleteBulkEvent } from "@spacebar/util";
import { AuditLogEvents } from "@spacebar/schemas";
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

const highestPosition = (member: Member | null, guild_id: string) => Math.max(0, ...(member?.roles ?? []).filter((role) => role.id !== guild_id).map((role) => role.position));

export async function banHierarchy(guild_id: string, actor_id: string) {
    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, owner_id: true } });
    const actor = guild.owner_id === actor_id ? null : await Member.findOne({ where: { id: actor_id, guild_id }, relations: { roles: true } });
    const actorHighest = highestPosition(actor, guild_id);
    return async (target_id: string) => {
        if (target_id === guild.owner_id) return false;
        if (guild.owner_id === actor_id) return true;
        if (target_id === actor_id) return false;
        const target = await Member.findOne({ where: { id: target_id, guild_id }, relations: { roles: true } });
        return !target || highestPosition(target, guild_id) < actorHighest;
    };
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

export async function banUser(opts: { guild_id: string; user_id: string; executor_id: string; reason?: string; delete_message_seconds: number; ip?: string }) {
    const user = await User.getPublicUser(opts.user_id).catch(() => null);
    if (!user) throw DiscordApiErrors.UNKNOWN_USER;
    if (await Ban.exists({ where: { guild_id: opts.guild_id, user_id: opts.user_id } })) return false;

    await Ban.create({ user_id: opts.user_id, guild_id: opts.guild_id, executor_id: opts.executor_id, reason: opts.reason, ip: opts.ip }).save();
    if (await Member.exists({ where: { id: opts.user_id, guild_id: opts.guild_id } })) await Member.removeFromGuild(opts.user_id, opts.guild_id);
    await deleteRecentMessages(opts.guild_id, [opts.user_id], opts.delete_message_seconds);
    await Promise.all([
        AuditLog.log({
            guild_id: opts.guild_id,
            user_id: opts.executor_id,
            action_type: AuditLogEvents.MEMBER_BAN_ADD,
            target_id: opts.user_id,
            reason: opts.reason,
            options: opts.delete_message_seconds ? { delete_member_days: String(Math.round(opts.delete_message_seconds / 86400)) } : undefined,
        }),
        emitEvent({
            event: "GUILD_BAN_ADD",
            data: { guild_id: opts.guild_id, user, delete_message_secs: opts.delete_message_seconds },
            guild_id: opts.guild_id,
        } satisfies GuildBanAddEvent),
    ]);
    return true;
}
