/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

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

import murmur from "murmurhash-js/murmurhash3_gc";
import { In } from "typeorm";
import { sendThreadMemberLists, syncThreadList } from "../util/ThreadSync";
import { Channel, Guild, Member, Role, User } from "@spacebar/database";
import { Stopwatch } from "@spacebar/extensions";
import { WebSocket, Payload, OPCODES, Send, handleOffloadedGatewayRequest, resolveSocket } from "@spacebar/gateway";
import { LazyRequestSchema } from "@spacebar/schemas";
import { getPermission, Permissions, Config, getUserPresences, AggregatedPresence } from "@spacebar/util";
import { check } from "./instanceOf";

const MAX_LIST_MEMBERS = 5000;
const OFFLINE_GROUP_LIMIT = 1000;

type MemberListItem = { group: { id: string; count: number } } | { member: Record<string, unknown> };

function getListId(channel: Channel) {
    const perms: string[] = [];
    for (const { id, allow, deny } of channel.permission_overwrites ?? []) {
        if (BigInt(allow) & Permissions.FLAGS.VIEW_CHANNEL) perms.push(`allow:${id}`);
        else if (BigInt(deny) & Permissions.FLAGS.VIEW_CHANNEL) perms.push(`deny:${id}`);
    }
    return perms.length ? murmur(perms.sort().join(",")).toString() : "everyone";
}

export async function buildMemberList(guild_id: string, channel_id: string) {
    const [guild, roles, channel, members] = await Promise.all([
        Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, owner_id: true } }),
        Role.find({ where: { guild_id } }),
        Channel.findOneOrFail({ where: { id: channel_id, guild_id } }),
        Member.find({ where: { guild_id }, relations: { user: true, roles: true }, take: MAX_LIST_MEMBERS }),
    ]);

    const visible = members.filter((member) =>
        Permissions.finalPermission({
            user: { id: member.id, roles: [guild_id, ...member.roles.map((r) => r.id)], communication_disabled_until: null, flags: 0 },
            guild: { id: guild.id, owner_id: guild.owner_id!, roles },
            channel: { overwrites: channel.permission_overwrites },
        }).has("VIEW_CHANNEL"),
    );

    const presences = await getUserPresences(visible.map((x) => x.id));
    const hoisted = roles.filter((r) => r.hoist && r.id !== guild_id).sort((a, b) => b.position - a.position);
    const displayName = (m: Member) => (m.nick || m.user.global_name || m.user.username || "").toLowerCase();
    const byName = (a: Member, b: Member) => displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id);

    const groups = new Map<string, Member[]>([...hoisted.map((r) => [r.id, [] as Member[]] as const), ["online", []], ["offline", []]]);
    for (const member of visible) {
        if (!presences.has(member.id)) {
            groups.get("offline")!.push(member);
            continue;
        }
        const role = hoisted.find((r) => member.roles.some((x) => x.id === r.id));
        groups.get(role?.id ?? "online")!.push(member);
    }
    if (visible.length > OFFLINE_GROUP_LIMIT) groups.set("offline", []);

    const toItem = (member: Member, presence?: AggregatedPresence) => ({
        member: {
            ...member.toPublicMember(),
            roles: member.roles.filter((r) => r.id !== guild_id).map((r) => r.id),
            user: member.user.toPublicUser(),
            presence: {
                user: { id: member.id },
                status: presence?.status ?? "offline",
                client_status: presence?.client_status ?? {},
                activities: presence?.activities ?? [],
                processed_at_timestamp: presence?.processed_at_timestamp ?? Date.now(),
            },
        },
    });

    const items: MemberListItem[] = [];
    const groupList: { id: string; count: number }[] = [];
    for (const [id, groupMembers] of groups) {
        if (!groupMembers.length) continue;
        const group = { id, count: groupMembers.length };
        groupList.push(group);
        items.push({ group });
        for (const member of groupMembers.sort(byName)) items.push(toItem(member, presences.get(member.id)));
    }

    return {
        id: getListId(channel),
        guild_id,
        member_count: members.length,
        online_count: visible.filter((x) => presences.has(x.id)).length,
        groups: groupList,
        items,
    };
}

export async function sendMemberListSync(this: WebSocket, guild_id: string) {
    const subscription = this.member_lists?.[guild_id];
    if (!subscription) return;
    const list = await buildMemberList(guild_id, subscription.channel_id);
    await Send(this, {
        op: OPCODES.Dispatch,
        s: this.sequence++,
        t: "GUILD_MEMBER_LIST_UPDATE",
        d: {
            ops: subscription.ranges.map((range) => ({ op: "SYNC", range, items: list.items.slice(range[0], range[1] + 1) })),
            online_count: list.online_count,
            member_count: list.member_count,
            id: list.id,
            guild_id,
            groups: list.groups,
        },
    });
}

export function scheduleMemberListSync(socket: WebSocket, guild_id: string) {
    const subscription = socket.member_lists?.[guild_id];
    if (!subscription || subscription.timer) return;
    subscription.timer = setTimeout(() => {
        subscription.timer = undefined;
        const current = resolveSocket(socket);
        if (current.readyState !== 1) return;
        sendMemberListSync.call(current, guild_id).catch((e) => console.error(`[Gateway/${socket.user_id}] member list sync failed`, e));
    }, 750);
}

export async function onLazyRequest(this: WebSocket, { d }: Payload) {
    const sw = Stopwatch.startNew();
    check.call(this, LazyRequestSchema, d);
    const { guild_id, channels, members, threads, thread_member_lists } = d as LazyRequestSchema;

    if (threads) await syncThreadList.call(this, guild_id);
    if (thread_member_lists?.length) await sendThreadMemberLists.call(this, guild_id, thread_member_lists as string[]);

    if (Config.get().offload.gateway.lazyRequestUrl !== null) {
        if (await handleOffloadedGatewayRequest(this, Config.get().offload.gateway.lazyRequestUrl!, d)) return;
    }

    if (members?.length) {
        const ids = members.filter((x) => typeof x === "string");
        const [presences, users] = await Promise.all([getUserPresences(ids), User.find({ where: { id: In(ids) } })]);
        for (const user of users) {
            const presence = presences.get(user.id);
            if (!presence) continue;
            await Send(this, {
                op: OPCODES.Dispatch,
                s: this.sequence++,
                t: "PRESENCE_UPDATE",
                d: { user: user.toPublicUser(), guild_id, ...presence },
            });
        }
    }

    const channel_id = Object.keys(channels || {})[0];
    if (!channel_id) return;

    const permissions = await getPermission(this.user_id, guild_id, channel_id).catch(() => undefined);
    if (!permissions?.has("VIEW_CHANNEL")) return;

    const ranges = channels![channel_id];
    if (!Array.isArray(ranges)) throw new Error("Not a valid Array");

    this.member_lists ??= {};
    const previous = this.member_lists[guild_id];
    if (previous?.timer) clearTimeout(previous.timer);
    this.member_lists[guild_id] = {
        channel_id,
        ranges: ranges.filter((x) => Array.isArray(x) && x.length === 2).map(([a, b]) => [Number(a) || 0, Number(b) || 0] as [number, number]),
    };

    await sendMemberListSync.call(this, guild_id).catch((e) => console.error(`[Gateway/${this.user_id}] member list sync failed`, e));

    console.log(`[Gateway/${this.user_id}] LAZY_REQUEST ${guild_id} ${channel_id} took ${sw.elapsed().toString()}`);
}
