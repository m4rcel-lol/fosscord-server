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

import { In } from "typeorm";
import { Channel, Member, Message, Session, ThreadMember } from "@spacebar/database";
import { getMostRelevantSession, getPermission, Permissions } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";
import { OPCODES } from "./Constants";
import { Send } from "./Send";
import { WebSocket } from "./WebSocket";

const synced = new WeakMap<WebSocket, Set<string>>();

export async function syncThreadList(this: WebSocket, guild_id: string) {
    const done = synced.get(this) ?? new Set<string>();
    synced.set(this, done);
    if (done.has(guild_id)) return;
    done.add(guild_id);

    const threads = (
        await Channel.find({
            where: { guild_id, type: In([ChannelType.GUILD_NEWS_THREAD, ChannelType.GUILD_PUBLIC_THREAD, ChannelType.GUILD_PRIVATE_THREAD]) },
        })
    ).filter((t) => !t.thread_metadata?.archived);
    const members = threads.length ? await ThreadMember.find({ where: { user_id: this.user_id, id: In(threads.map((t) => t.id)) } }) : [];
    const joined = new Set(members.map((m) => m.id));

    const parentPerms = new Map<string, Permissions>();
    const visible: Channel[] = [];
    for (const thread of threads) {
        if (!thread.parent_id) continue;
        if (!parentPerms.has(thread.parent_id)) parentPerms.set(thread.parent_id, await getPermission(this.user_id, guild_id, thread.parent_id).catch(() => new Permissions(0)));
        const perms = parentPerms.get(thread.parent_id)!;
        if (!perms.has("VIEW_CHANNEL")) continue;
        if (thread.type === ChannelType.GUILD_PRIVATE_THREAD && !joined.has(thread.id) && !perms.has("MANAGE_THREADS")) continue;
        visible.push(thread);
    }

    const lastIds = visible.map((t) => t.last_message_id).filter((id): id is string => !!id);
    const recent = lastIds.length ? await Message.find({ where: { id: In(lastIds) }, relations: { author: true, attachments: true, sticker_items: true } }) : [];

    await Send(this, {
        op: OPCODES.Dispatch,
        t: "THREAD_LIST_SYNC",
        s: this.sequence++,
        d: {
            guild_id,
            threads: visible.map((t) => t.toJSON()),
            members: members.filter((m) => visible.some((t) => t.id === m.id)).map((m) => m.toJSON()),
            most_recent_messages: recent.map((m) => m.toPublicJSON(this.user_id)),
        },
    });
}

export async function sendThreadMemberLists(this: WebSocket, guild_id: string, thread_ids: string[]) {
    for (const thread_id of thread_ids.slice(0, 10)) {
        const thread = await Channel.findOne({ where: { id: thread_id, guild_id } });
        if (!thread?.isThread() || !thread.parent_id) continue;
        const perms = await getPermission(this.user_id, guild_id, thread.parent_id).catch(() => new Permissions(0));
        if (!perms.has("VIEW_CHANNEL")) continue;
        if (thread.isPrivateThread() && !perms.has("MANAGE_THREADS") && !(await ThreadMember.existsBy({ id: thread.id, user_id: this.user_id }))) continue;

        const threadMembers = await ThreadMember.find({ where: { id: thread.id }, take: 100 });
        const userIds = threadMembers.map((m) => m.user_id);
        const [members, sessions] = await Promise.all([
            userIds.length ? Member.find({ where: { guild_id, id: In(userIds) }, relations: { user: true, roles: true } }) : Promise.resolve([] as Member[]),
            userIds.length ? Session.find({ where: { user_id: In(userIds) } }) : Promise.resolve([] as Session[]),
        ]);
        const memberById = new Map(members.map((m) => [m.id, m]));

        await Send(this, {
            op: OPCODES.Dispatch,
            t: "THREAD_MEMBER_LIST_UPDATE",
            s: this.sequence++,
            d: {
                guild_id,
                thread_id: thread.id,
                members: threadMembers.flatMap((tm) => {
                    const member = memberById.get(tm.user_id);
                    if (!member) return [];
                    const session = getMostRelevantSession(sessions.filter((x) => x.user_id === tm.user_id));
                    return [
                        {
                            ...tm.toJSON(),
                            member: { ...member.toPublicMember(), roles: member.roles.filter((r) => r.id !== guild_id).map((r) => r.id) },
                            presence: session
                                ? {
                                      user: { id: tm.user_id },
                                      guild_id,
                                      status: session.getPublicStatus(),
                                      activities: session.activities ?? [],
                                      client_status: session.client_status ?? {},
                                  }
                                : null,
                        },
                    ];
                }),
            },
        });
    }
}
