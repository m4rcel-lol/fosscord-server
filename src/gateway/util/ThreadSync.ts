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
import { Channel, Message, ThreadMember } from "@spacebar/database";
import { getPermission, Permissions } from "@spacebar/util";
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
            most_recent_messages: recent.map((m) => m.toJSON()),
        },
    });
}
