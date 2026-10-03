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

import { Channel, Guild, Member, Role, ThreadMember } from "@spacebar/database";
import { Permissions, PRESENCE_STALE_AFTER_MS } from "@spacebar/util";
import { RelationshipType, UserGuildSettings } from "@spacebar/schemas";

export interface AudienceMember {
    id: string;
    roles: string[];
    settings: Partial<UserGuildSettings> | null;
}

export interface MentionTarget {
    channel: Channel;
    author_id?: string;
    user_ids: string[];
    role_ids: string[];
    everyone: boolean;
    here: boolean;
}

export const loadAudienceMembers = (guild_id: string, filter: { all: boolean; ids: string[]; roles: string[] }): Promise<AudienceMember[]> =>
    Member.query(
        `SELECT m.id::text AS id, m.settings, COALESCE(array_agg(mr.role_id::text) FILTER (WHERE mr.role_id IS NOT NULL), '{}') AS roles
         FROM members m LEFT JOIN member_roles mr ON mr.index = m.index
         WHERE m.guild_id = $1 AND ($2::boolean OR m.id = ANY($3::bigint[]) OR m.index IN (SELECT index FROM member_roles WHERE role_id = ANY($4::bigint[])))
         GROUP BY m.index`,
        [guild_id, filter.all, filter.ids, filter.roles],
    );

export async function channelViewChecker(channel: Channel) {
    const guild_id = channel.guild_id!;
    const [guild, roles, source] = await Promise.all([
        Guild.findOne({ where: { id: guild_id }, select: { id: true, owner_id: true } }),
        Role.find({ where: { guild_id }, select: { id: true, permissions: true } }),
        channel.isThread() && channel.parent_id ? Channel.findOne({ where: { id: channel.parent_id }, select: { id: true, permission_overwrites: true } }) : channel,
    ]);
    return (member: AudienceMember) =>
        Permissions.finalPermission({
            user: { id: member.id, roles: [guild_id, ...member.roles], communication_disabled_until: null, flags: 0 },
            guild: { id: guild_id, owner_id: guild?.owner_id ?? "", roles },
            channel: { overwrites: source?.permission_overwrites ?? [] },
        }).has("VIEW_CHANNEL");
}

export async function usersBlocking(author_id: string | undefined, ids: string[]) {
    if (!author_id || !ids.length) return new Set<string>();
    const rows: { id: string }[] = await Member.query(
        `SELECT from_id::text AS id FROM relationships WHERE to_id = $1 AND (type = $2 OR user_ignored) AND from_id = ANY($3::bigint[])`,
        [author_id, RelationshipType.BLOCKED, ids],
    );
    return new Set(rows.map((r) => r.id));
}

export async function onlineUsers(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows: { user_id: string }[] = await Member.query(
        `SELECT DISTINCT user_id::text AS user_id FROM sessions WHERE user_id = ANY($1::bigint[]) AND status <> 'offline' AND NOT is_admin_session AND last_seen > $2`,
        [ids, new Date(Date.now() - PRESENCE_STALE_AFTER_MS)],
    );
    return new Set(rows.map((r) => r.user_id));
}

export async function threadMemberIds(thread_id: string) {
    return new Set((await ThreadMember.find({ where: { id: thread_id }, select: { user_id: true } })).map((m) => m.user_id));
}

export async function getMentionedUsers(target: MentionTarget) {
    const { channel, author_id } = target;
    if (channel.isDm()) {
        const ids = (channel.recipients ?? []).map((r) => r.user_id).filter((id) => id !== author_id);
        const blocked = await usersBlocking(author_id, ids);
        return new Set(ids.filter((id) => !blocked.has(id)));
    }

    const broad = target.everyone || target.here;
    if (!channel.guild_id || (!broad && !target.user_ids.length && !target.role_ids.length)) return new Set<string>();

    const threadMembers = channel.isThread() ? await threadMemberIds(channel.id) : null;
    const members = await loadAudienceMembers(channel.guild_id, {
        all: broad && !threadMembers,
        ids: [...target.user_ids, ...(broad && threadMembers ? threadMembers : [])],
        roles: target.role_ids,
    });
    const online = target.here ? await onlineUsers(members.map((m) => m.id)) : new Set<string>();
    const canView = await channelViewChecker(channel);

    const mentioned = members
        .filter((member) => {
            if (member.id === author_id) return false;
            const direct = target.user_ids.includes(member.id);
            if (channel.isPrivateThread() && !direct && !threadMembers?.has(member.id)) return false;
            const role = !member.settings?.suppress_roles && member.roles.some((id) => target.role_ids.includes(id));
            const everyone = !member.settings?.suppress_everyone && (!threadMembers || threadMembers.has(member.id)) && (target.everyone || (target.here && online.has(member.id)));
            return (direct || role || everyone) && canView(member);
        })
        .map((member) => member.id);
    const blocked = await usersBlocking(author_id, mentioned);
    return new Set(mentioned.filter((id) => !blocked.has(id)));
}
