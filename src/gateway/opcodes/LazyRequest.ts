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
const RANGE_SIZE = 100;
const MAX_RANGES = 5;
const MAX_OPS = 50;
const REFRESH_DELAY = 500;

type MemberListItem = { group: { id: string; count: number } } | { member: Record<string, unknown> };
type ListEntry = { key: string; compare: string; item: MemberListItem };
type MemberList = { id: string; guild_id: string; member_count: number; online_count: number; groups: { id: string; count: number }[]; entries: ListEntry[] };
type LoadedMembers = { roles: Role[]; channel: Channel; members: Member[]; visible: Member[] };
type Staleness = "presence" | "members";
type ListState = {
    key: string;
    guild_id: string;
    channel_id: string;
    loaded?: LoadedMembers;
    list?: MemberList;
    pending?: Promise<MemberList>;
    stale?: Staleness;
    timer?: NodeJS.Timeout;
    subscribers: Set<WebSocket>;
};
type ListOp = { op: "SYNC"; range: [number, number]; items: MemberListItem[] } | { op: "INSERT" | "UPDATE"; index: number; item: MemberListItem } | { op: "DELETE"; index: number };

const lists = new Map<string, ListState>();
const guildLists = new Map<string, Set<string>>();

function getListId(channel: Channel) {
    const perms: string[] = [];
    for (const { id, allow, deny } of channel.permission_overwrites ?? []) {
        if (BigInt(allow) & Permissions.FLAGS.VIEW_CHANNEL) perms.push(`allow:${id}`);
        else if (BigInt(deny) & Permissions.FLAGS.VIEW_CHANNEL) perms.push(`deny:${id}`);
    }
    return perms.length ? murmur(perms.sort().join(",")).toString() : "everyone";
}

async function loadMembers(guild_id: string, channel_id: string): Promise<LoadedMembers> {
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
    return { roles, channel, members, visible };
}

async function layoutMembers({ roles, channel, members, visible }: LoadedMembers, guild_id: string): Promise<MemberList> {
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

    const toEntry = (member: Member, presence?: AggregatedPresence): ListEntry => {
        const state = {
            user: { id: member.id },
            status: presence?.status ?? "offline",
            client_status: presence?.client_status ?? {},
            activities: presence?.activities ?? [],
        };
        const data = {
            ...member.toPublicMember(),
            roles: member.roles.filter((r) => r.id !== guild_id).map((r) => r.id),
            user: member.user.toPartialUser(),
        };
        return {
            key: `member:${member.id}`,
            compare: JSON.stringify({ ...data, presence: state }),
            item: { member: { ...data, presence: { ...state, processed_at_timestamp: presence?.processed_at_timestamp ?? Date.now() } } },
        };
    };

    const entries: ListEntry[] = [];
    const groupList: { id: string; count: number }[] = [];
    for (const [id, groupMembers] of groups) {
        if (!groupMembers.length) continue;
        const group = { id, count: groupMembers.length };
        groupList.push(group);
        entries.push({ key: `group:${id}`, compare: JSON.stringify(group), item: { group } });
        for (const member of groupMembers.sort(byName)) entries.push(toEntry(member, presences.get(member.id)));
    }

    return {
        id: getListId(channel),
        guild_id,
        member_count: members.length,
        online_count: visible.filter((x) => presences.has(x.id)).length,
        groups: groupList,
        entries,
    };
}

export async function buildMemberList(guild_id: string, channel_id: string) {
    const list = await layoutMembers(await loadMembers(guild_id, channel_id), guild_id);
    return { ...list, items: list.entries.map((x) => x.item) };
}

function rebuild(state: ListState) {
    state.pending ??= (async () => {
        try {
            const reload = !state.loaded || state.stale === "members";
            state.stale = undefined;
            if (reload) state.loaded = await loadMembers(state.guild_id, state.channel_id);
            state.list = await layoutMembers(state.loaded!, state.guild_id);
            return state.list;
        } finally {
            state.pending = undefined;
        }
    })();
    return state.pending;
}

function diffEntries(before: ListEntry[], after: ListEntry[]): ListOp[] | undefined {
    const keys = before.map((x) => x.key);
    const compares = before.map((x) => x.compare);
    const target = new Map(after.map((x, i) => [x.key, i]));
    const ops: ListOp[] = [];
    for (let i = keys.length - 1; i >= 0; i--) {
        if (target.has(keys[i])) continue;
        ops.push({ op: "DELETE", index: i });
        keys.splice(i, 1);
        compares.splice(i, 1);
    }
    for (let i = 0; i < after.length; i++) {
        if (ops.length > MAX_OPS) return undefined;
        const { key, compare, item } = after[i];
        if (keys[i] === key) {
            if (compares[i] !== compare) ops.push({ op: "UPDATE", index: i, item });
            compares[i] = compare;
            continue;
        }
        const from = keys.indexOf(key, i + 1);
        const displaced = i < keys.length ? target.get(keys[i])! - i : -1;
        if (from !== -1 && displaced > from - i) {
            ops.push({ op: "DELETE", index: i });
            keys.splice(i, 1);
            compares.splice(i, 1);
            i--;
            continue;
        }
        if (from !== -1) {
            ops.push({ op: "DELETE", index: from });
            keys.splice(from, 1);
            compares.splice(from, 1);
        }
        ops.push({ op: "INSERT", index: i, item });
        keys.splice(i, 0, key);
        compares.splice(i, 0, compare);
    }
    return ops.length > MAX_OPS ? undefined : ops;
}

const syncOps = (list: MemberList, ranges: [number, number][]): ListOp[] =>
    ranges.map((range) => ({ op: "SYNC", range, items: list.entries.slice(range[0], range[1] + 1).map((x) => x.item) }));

function sendListUpdate(socket: WebSocket, list: MemberList, ops: ListOp[]) {
    return Send(socket, {
        op: OPCODES.Dispatch,
        s: socket.sequence++,
        t: "GUILD_MEMBER_LIST_UPDATE",
        d: { ops, online_count: list.online_count, member_count: list.member_count, id: list.id, guild_id: list.guild_id, groups: list.groups },
    });
}

function dropState(state: ListState) {
    if (state.timer) clearTimeout(state.timer);
    lists.delete(state.key);
    const keys = guildLists.get(state.guild_id);
    keys?.delete(state.key);
    if (!keys?.size) guildLists.delete(state.guild_id);
}

function liveSubscribers(state: ListState) {
    const live: WebSocket[] = [];
    for (const socket of [...state.subscribers]) {
        const current = resolveSocket(socket);
        if (current !== socket) {
            state.subscribers.delete(socket);
            state.subscribers.add(current);
        }
        if (current.readyState === 3 || current.member_lists?.[state.guild_id]?.key !== state.key) {
            state.subscribers.delete(current);
            continue;
        }
        if (current.readyState === 1) live.push(current);
    }
    return live;
}

async function refresh(state: ListState) {
    state.timer = undefined;
    if (!liveSubscribers(state).length) return dropState(state);
    const before = state.list;
    const after = await rebuild(state);
    if (state.key !== `${state.guild_id}:${after.id}`) {
        dropState(state);
        await Promise.all(
            liveSubscribers(state).map((socket) =>
                resyncMemberList(socket, state.guild_id).catch((e) => console.error(`[Gateway/${socket.user_id}] member list resync failed`, e)),
            ),
        );
        return;
    }
    const ops = before ? diffEntries(before.entries, after.entries) : undefined;
    if (ops?.length === 0 && before?.online_count === after.online_count && before?.member_count === after.member_count) return;
    await Promise.all(
        liveSubscribers(state).map((socket) =>
            sendListUpdate(socket, after, ops ?? syncOps(after, socket.member_lists![state.guild_id].ranges)).catch((e) =>
                console.error(`[Gateway/${socket.user_id}] member list update failed`, e),
            ),
        ),
    );
}

export function markMemberListsStale(guild_id: string, staleness: Staleness) {
    for (const key of guildLists.get(guild_id) ?? []) {
        const state = lists.get(key);
        if (!state) continue;
        if (state.stale !== "members") state.stale = staleness;
        state.timer ??= setTimeout(() => refresh(state).catch((e) => console.error(`[Gateway] member list refresh for ${guild_id} failed`, e)), REFRESH_DELAY);
    }
}

export function resubscribeMemberLists(socket: WebSocket) {
    for (const subscription of Object.values(socket.member_lists ?? {})) lists.get(subscription.key)?.subscribers.add(socket);
}

function normalizeRanges(ranges: unknown[]) {
    const seen = new Set<string>();
    const result: [number, number][] = [];
    for (const range of ranges) {
        if (!Array.isArray(range) || range.length !== 2) continue;
        const start = Math.max(0, Math.floor(Number(range[0]) || 0));
        const end = Math.min(Math.max(start, Math.floor(Number(range[1]) || 0)), start + RANGE_SIZE - 1);
        if (seen.has(`${start}:${end}`)) continue;
        seen.add(`${start}:${end}`);
        result.push([start, end]);
        if (result.length >= MAX_RANGES) break;
    }
    return result;
}

async function subscribeMemberList(socket: WebSocket, guild_id: string, channel: Channel, ranges: [number, number][]) {
    const key = `${guild_id}:${getListId(channel)}`;
    let state = lists.get(key);
    if (!state) {
        state = { key, guild_id, channel_id: channel.id, subscribers: new Set() };
        lists.set(key, state);
        if (!guildLists.has(guild_id)) guildLists.set(guild_id, new Set());
        guildLists.get(guild_id)!.add(key);
    }
    const watched = liveSubscribers(state).some((x) => x !== socket);
    socket.member_lists ??= {};
    socket.member_lists[guild_id] = { channel_id: channel.id, ranges, key };
    state.subscribers.add(socket);
    if (!watched) state.stale = "members";
    const list = (watched && state.list) || (await rebuild(state));
    if (socket.readyState !== 1 || socket.member_lists[guild_id]?.key !== key) return;
    await sendListUpdate(socket, list, syncOps(list, ranges));
}

export async function resyncMemberList(socket: WebSocket, guild_id: string) {
    const subscription = socket.member_lists?.[guild_id];
    if (!subscription) return;
    const channel = await Channel.findOne({ where: { id: subscription.channel_id, guild_id } });
    if (!channel) return void delete socket.member_lists![guild_id];
    await subscribeMemberList(socket, guild_id, channel, subscription.ranges);
}

setInterval(() => {
    for (const state of lists.values()) if (!state.timer && !state.pending && !liveSubscribers(state).length) dropState(state);
}, 60_000).unref();

export async function onLazyRequest(this: WebSocket, { d }: Payload) {
    const sw = Stopwatch.startNew();
    check.call(this, LazyRequestSchema, d);
    const { guild_id, channels, members, threads, thread_member_lists } = d as LazyRequestSchema;

    if (threads) await syncThreadList.call(this, guild_id);
    if (thread_member_lists?.length) await sendThreadMemberLists.call(this, guild_id, thread_member_lists as string[]);

    if (Config.get().offload.gateway.lazyRequestUrl !== null) {
        if (await handleOffloadedGatewayRequest(this, Config.get().offload.gateway.lazyRequestUrl!, d)) return;
    }

    if (members) {
        this.presenceSubscriptions ??= {};
        this.presenceSubscriptions[guild_id] = new Set(members.filter((x) => typeof x === "string").slice(0, 100));
    }

    if (members?.length) {
        const ids = members.filter((x) => typeof x === "string").slice(0, 100);
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
    if (!channel_id || this.readyState !== 1) return;

    const permissions = await getPermission(this.user_id, guild_id, channel_id).catch(() => undefined);
    if (!permissions?.has("VIEW_CHANNEL") || this.readyState !== 1) return;

    const ranges = channels![channel_id];
    if (!Array.isArray(ranges)) throw new Error("Not a valid Array");

    const channel = await Channel.findOne({ where: { id: channel_id, guild_id } });
    if (!channel || this.readyState !== 1) return;

    await subscribeMemberList(this, guild_id, channel, normalizeRanges(ranges)).catch((e) => console.error(`[Gateway/${this.user_id}] member list sync failed`, e));

    console.log(`[Gateway/${this.user_id}] LAZY_REQUEST ${guild_id} ${channel_id} took ${sw.elapsed().toString()}`);
}
