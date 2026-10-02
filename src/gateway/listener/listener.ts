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

import { Channel as AMQChannel } from "amqplib";
import { bgRedBright } from "picocolors";
import { Ban, Member, Message, Recipient, Relationship, ThreadMember, User } from "@spacebar/database";
import { EVENTEnum, EventOpts, getPermission, listenEvent, ListenEventOpts, NewUrlUserSignatureData, Permissions, RabbitMQ } from "@spacebar/util";
import { WebSocket } from "@spacebar/gateway";
import { ChannelType, PublicMember, RelationshipType } from "@spacebar/schemas";
import { In, Not } from "typeorm";
import { CLOSECODES, holdForResume, OPCODES, resolveSocket, Send } from "../util";
import { scheduleMemberListSync } from "../opcodes/LazyRequest";

// TODO: close connection on Invalidated Token
// TODO: check intent
// TODO: Guild Member Update is sent for current-user updates regardless of whether the GUILD_MEMBERS intent is set.

// Sharding: calculate if the current shard id matches the formula: shard_id = (guild_id >> 22) % num_shards
// https://discord.com/developers/docs/topics/gateway#sharding

export function handlePresenceUpdate(this: WebSocket, opts: EventOpts): Promise<unknown> | undefined {
    if (this.resumedBy) return handlePresenceUpdate.call(resolveSocket(this), opts);
    const { event, acknowledge, data, user_id } = opts;
    acknowledge?.();
    if (event === EVENTEnum.PresenceUpdate && data?.user?.id === user_id && user_id !== this.user_id) {
        return Send(this, {
            op: OPCODES.Dispatch,
            t: event,
            d: data,
            s: this.sequence++,
        });
    }
}

export async function setupListener(this: WebSocket) {
    const [members, recipients, relationships, threadMembers, user] = await Promise.all([
        Member.find({
            where: { id: this.user_id },
            relations: { guild: { channels: true }, roles: true },
            select: {
                index: true,
                id: true,
                guild_id: true,
                communication_disabled_until: true,
                roles: { id: true, permissions: true, position: true },
                guild: { id: true, owner_id: true, channels: { id: true, type: true, parent_id: true, permission_overwrites: true } },
            },
        }),
        Recipient.find({ where: { user_id: this.user_id, closed: false }, select: { id: true, channel_id: true } }),
        Relationship.find({ where: { from_id: this.user_id, type: RelationshipType.FRIEND }, select: { id: true, to_id: true } }),
        ThreadMember.find({ where: { user_id: this.user_id }, select: { id: true } }),
        User.findOne({ where: { id: this.user_id }, select: { id: true, flags: true } }),
    ]);
    const joinedThreads = new Set(threadMembers.map((m) => m.id));
    const dmUsers = recipients.length
        ? await Recipient.find({ where: { channel_id: In(recipients.map((x) => x.channel_id)), user_id: Not(this.user_id) }, select: { id: true, user_id: true } })
        : [];
    this.affinityUsers = new Set([...relationships.map((x) => x.to_id), ...dmUsers.map((x) => x.user_id)]);

    const guildIds: string[] = [];
    const channelIds: string[] = recipients.map((x) => x.channel_id);
    const friendIds = relationships.map((x) => x.to_id);
    for (const member of members) {
        const guild = member.guild;
        const permission = Permissions.finalPermission({
            user: { id: this.user_id, roles: member.roles.map((x) => x.id), communication_disabled_until: member.communication_disabled_until ?? null, flags: user?.flags ?? 0 },
            guild: { id: guild.id, owner_id: guild.owner_id!, roles: member.roles },
        });
        permission.cache = { roles: member.roles, user_id: this.user_id };
        this.permissions[guild.id] = permission;
        guildIds.push(guild.id);

        const byId = new Map(guild.channels.map((channel) => [channel.id, channel]));
        for (const channel of guild.channels) {
            const source = channel.isThread() ? byId.get(channel.parent_id!) : channel;
            if (!source) continue;
            const perms = permission.overwriteChannel(source.permission_overwrites ?? []);
            if (!perms.has("VIEW_CHANNEL")) continue;
            if (channel.type === ChannelType.GUILD_PRIVATE_THREAD && !joinedThreads.has(channel.id) && !perms.has("MANAGE_THREADS")) continue;
            channelIds.push(channel.id);
        }
    }

    const opts: {
        acknowledge: boolean;
        channel?: AMQChannel & { queues?: unknown; ch?: number };
    } = {
        acknowledge: true,
    };
    this.listen_options = opts;
    const consumer = consume.bind(this);
    const presenceConsumer = handlePresenceUpdate.bind(this);

    const handleChannelError = (err: unknown) => {
        console.error(`[RabbitMQ] [user-${this.user_id}] Channel Error (Handled):`, err);
    };

    const setupEventListeners = async () => {
        if (RabbitMQ.connection) {
            console.log(`[RabbitMQ] [user-${this.user_id}] Setting up channel and event listeners`);
            opts.channel = await RabbitMQ.connection.createChannel();

            opts.channel.on("error", handleChannelError);
            opts.channel.queues = {};
            console.log("[RabbitMQ] channel created: ", typeof opts.channel, "with channel id", opts.channel?.ch);
        }

        this.events[this.user_id] = await listenEvent(this.user_id, consumer, opts);
        this.events[this.session_id] = await listenEvent(this.session_id, consumer, opts);

        await Promise.all([
            ...friendIds.map(async (id) => {
                this.events[id] = await listenEvent(id, presenceConsumer, opts);
            }),
            ...[...guildIds, ...channelIds].map(async (id) => {
                this.events[id] = await listenEvent(id, consumer, opts);
            }),
        ]);
    };

    // Initial setup
    await setupEventListeners();

    // Handle RabbitMQ reconnection - re-establish all subscriptions
    const handleReconnect = async () => {
        console.log(`[RabbitMQ] [user-${this.user_id}] Connection restored, re-establishing subscriptions`);
        try {
            // Clear old event handlers (they're now invalid)
            this.events = {};
            this.member_events = {};
            opts.channel = undefined;

            // re-establish all subscriptions
            await setupEventListeners();
            console.log(`[RabbitMQ] [user-${this.user_id}] Successfully re-established subscriptions`);
        } catch (e) {
            console.error(`[RabbitMQ] [user-${this.user_id}] Failed to re-establish subscriptions:`, e);
            // close the WebSocket - will force client to reconnect and redo subscription setup
            this.close(4000, "Failed to re-establish event subscriptions");
        }
    };

    const handleDisconnect = () => {
        console.log(`[RabbitMQ] [user-${this.user_id}] Connection lost, waiting for reconnection`);
        // mark channel invalid
        if (opts.channel) {
            opts.channel.off("error", handleChannelError);
        }
        opts.channel = undefined;
    };

    // Subscribe to RabbitMQ connection events
    RabbitMQ.on("reconnected", handleReconnect);
    RabbitMQ.on("disconnected", handleDisconnect);

    this.listenerCleanup = async () => {
        RabbitMQ.off("reconnected", handleReconnect);
        RabbitMQ.off("disconnected", handleDisconnect);

        // wait for event consumer cancellation
        await Promise.all(
            Object.values(this.events).map((x) => {
                if (x) return x();
                else return Promise.resolve();
            }),
        );
        await Promise.all(Object.values(this.member_events).map((x) => x()));

        if (opts.channel) {
            try {
                await opts.channel.close();
            } catch {
                // Channel might already be closed
            }
            opts.channel.off("error", handleChannelError);
        }
    };
    if (this.readyState === this.CLOSED) await this.listenerCleanup();
    else this.once("close", (code: number) => holdForResume(this, this.listenerCleanup!, code));
}

// TODO: only subscribe for events that are in the connection intents
async function consume(this: WebSocket, opts: EventOpts): Promise<void> {
    if (this.resumedBy) return consume.call(resolveSocket(this), opts);
    const { data, event } = opts;
    const id = (opts.guild_id || opts.channel_id || opts.user_id || opts.session_id) as string;
    const permission = this.permissions[id] || new Permissions("ADMINISTRATOR"); // default permission for dm

    const consumer = consume.bind(this);
    const listenOpts = opts as ListenEventOpts;
    opts.acknowledge?.();
    // console.log("event", event);

    // deduplicate gateway messages
    if (opts.transaction_id) {
        if (this.recentTransactions.includes(opts.transaction_id)) return;
        this.recentTransactions.push(opts.transaction_id);
        if (this.recentTransactions.length > 100) this.recentTransactions = this.recentTransactions.slice(1);
    }

    // special codes
    switch (event) {
        case "SB_SESSION_CLOSE":
            // TODO: what do we even send here?
            await Send(this, {
                op: OPCODES.Reconnect,
                s: this.sequence++,
                d: opts.reconnect_delay ?? opts.data ?? 1000,
            });
            this.close(1000); // not a discord close code, standard WS "Normal Closure"
            return;
        case "SB_SESSION_REMOVE":
            // TODO: what do we even send here?
            await Send(this, {
                op: OPCODES.Invalid_Session,
                s: this.sequence++,
            });
            this.close(CLOSECODES.Invalid_session); // TODO: this is deprecated?
            return;
        default:
            // no special treatment
            break;
    }

    // subscription managment
    switch (event) {
        case "GUILD_MEMBER_REMOVE":
            this.member_events[data.user.id]?.();
            delete this.member_events[data.user.id];
            break;
        case "GUILD_MEMBER_ADD":
            if (this.member_events[data.user.id]) break; // already subscribed
            this.member_events[data.user.id] = await listenEvent(data.user.id, handlePresenceUpdate.bind(this), this.listen_options);
            break;
        case "GUILD_MEMBER_UPDATE":
            if (!this.member_events[data.user.id]) break;
            await this.member_events[data.user.id]();
            break;
        case "RELATIONSHIP_REMOVE":
        case "CHANNEL_DELETE":
        case "GUILD_DELETE": {
            const target = typeof data?.id === "string" ? data.id : id;
            if (target !== this.user_id && target !== this.session_id) {
                this.events[target]?.();
                delete this.events[target];
            }
            if (event === "GUILD_DELETE") delete this.permissions[target];
            if (event === "GUILD_DELETE" && this.ipAddress) {
                const ban = await Ban.findOne({
                    where: { guild_id: target, user_id: this.user_id },
                });

                if (ban) {
                    ban.ip = this.ipAddress || undefined;
                    await ban.save();
                }
            }
            break;
        }
        case "CHANNEL_CREATE":
            for (const recipient of data.recipients ?? []) if (recipient?.id && recipient.id !== this.user_id) this.affinityUsers?.add(recipient.id);
            if (!permission.overwriteChannel(data.permission_overwrites).has("VIEW_CHANNEL")) return;
            if (!this.events[data.id]) this.events[data.id] = await listenEvent(data.id, consumer, listenOpts);
            break;
        case "THREAD_CREATE":
            if (!this.events[data.id]) this.events[data.id] = await listenEvent(data.id, consumer, listenOpts);
            break;
        case "THREAD_DELETE":
            this.events[data.id]?.();
            delete this.events[data.id];
            break;
        case "RELATIONSHIP_ADD":
            this.affinityUsers?.add(data.user.id);
            this.events[data.user.id] = await listenEvent(data.user.id, handlePresenceUpdate.bind(this), this.listen_options);
            break;
        case "GUILD_CREATE": {
            const guildPermission = await getPermission(this.user_id, data.id).catch(() => undefined);
            if (guildPermission) this.permissions[data.id] = guildPermission;
            const subscribe = async (target: string) => {
                if (this.events[target]) return;
                this.events[target] = await listenEvent(target, consumer, listenOpts);
            };
            await Promise.all([...data.channels.map(({ id }: { id: string }) => subscribe(id)), subscribe(data.id)]);
            break;
        }
        case "CHANNEL_UPDATE": {
            const exists = this.events[id];
            if (permission.overwriteChannel(data.permission_overwrites).has("VIEW_CHANNEL")) {
                if (exists) break;
                this.events[id] = await listenEvent(id, consumer, listenOpts);
            } else {
                if (!exists) return; // return -> do not send channel update events for hidden channels
                opts.cancel(id);
                delete this.events[id];
            }
            break;
        }
        default:
            // no special treatment
            break;
    }

    // permission checking
    switch (event) {
        case "INVITE_CREATE":
        case "INVITE_DELETE":
        case "GUILD_INTEGRATIONS_UPDATE":
            if (!permission.has("MANAGE_GUILD")) return;
            break;
        case "WEBHOOKS_UPDATE":
            if (!permission.has("MANAGE_WEBHOOKS")) return;
            break;
        case "GUILD_MEMBER_ADD":
        case "GUILD_MEMBER_REMOVE":
        case "GUILD_MEMBER_UPDATE": // only send them, if the user subscribed for this part of the member list, or is a bot
            break;
        case "PRESENCE_UPDATE": {
            const presenceUser = data?.user?.id;
            if (presenceUser === this.user_id && !data.guild_id) return;
            if (
                data?.guild_id &&
                !this.isBot &&
                presenceUser !== this.user_id &&
                !this.affinityUsers?.has(presenceUser) &&
                !this.member_lists?.[data.guild_id] &&
                !this.presenceSubscriptions?.[data.guild_id]?.has(presenceUser)
            )
                return;
            break;
        }
        case "GUILD_BAN_ADD":
        case "GUILD_BAN_REMOVE":
            if (!permission.has("BAN_MEMBERS")) return;
            break;
        case "VOICE_STATE_UPDATE":
        case "MESSAGE_CREATE":
        case "MESSAGE_DELETE":
        case "MESSAGE_DELETE_BULK":
        case "MESSAGE_UPDATE":
        case "CHANNEL_PINS_UPDATE":
        case "MESSAGE_REACTION_ADD":
        case "MESSAGE_REACTION_REMOVE":
        case "MESSAGE_REACTION_REMOVE_ALL":
        case "MESSAGE_REACTION_REMOVE_EMOJI":
        case "TYPING_START":
            // only gets send if the user is alowed to view the current channel
            if (!permission.has("VIEW_CHANNEL")) return;
            break;
        case "GUILD_CREATE":
        case "GUILD_DELETE":
        case "GUILD_UPDATE":
        case "GUILD_ROLE_CREATE":
        case "GUILD_ROLE_UPDATE":
        case "GUILD_ROLE_DELETE":
        case "CHANNEL_CREATE":
        case "CHANNEL_DELETE":
        case "CHANNEL_UPDATE":
        case "GUILD_EMOJIS_UPDATE":
        case "READY": // will be sent by the gateway
        case "USER_UPDATE":
        case "APPLICATION_COMMAND_CREATE":
        case "APPLICATION_COMMAND_DELETE":
        case "APPLICATION_COMMAND_UPDATE":
        default:
            // always gets sent
            // Any events not defined in an intent are considered "passthrough" and will always be sent
            break;
    }

    // data rewrites, e.g. signed attachment URLs
    switch (event) {
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            // console.log(this.request)
            if (data["attachments"])
                data["attachments"] = Message.prototype.withSignedAttachments.call(
                    data,
                    new NewUrlUserSignatureData({
                        ip: this.ipAddress,
                        userAgent: this.userAgent,
                    }),
                ).attachments;
            if (data["components"]) {
                data["components"] = Message.prototype.withSignedAttachments.call(
                    data,
                    new NewUrlUserSignatureData({
                        ip: this.ipAddress,
                        userAgent: this.userAgent,
                    }),
                ).components;
            }
            break;
        default:
            break;
    }

    if (event === "GUILD_MEMBER_ADD") {
        if ((data as PublicMember).roles === undefined || (data as PublicMember).roles === null) {
            console.log(
                bgRedBright(`[Gateway/${this.user_id}]`),
                "[GUILD_MEMBER_ADD] roles is undefined, setting to empty array!",
                opts.origin ?? "(Event origin not defined)",
                data,
            );
            (data as PublicMember).roles = [];
        }
    }

    await Send(this, {
        op: OPCODES.Dispatch,
        t: event,
        d: data,
        s: this.sequence++,
    });

    const listGuildId = opts.guild_id ?? data?.guild_id;
    if (listGuildId && this.member_lists?.[listGuildId] && MemberListEvents.has(event)) scheduleMemberListSync(this, listGuildId);
}

const MemberListEvents = new Set([
    "PRESENCE_UPDATE",
    "GUILD_MEMBER_ADD",
    "GUILD_MEMBER_UPDATE",
    "GUILD_MEMBER_REMOVE",
    "GUILD_ROLE_CREATE",
    "GUILD_ROLE_UPDATE",
    "GUILD_ROLE_DELETE",
    "CHANNEL_UPDATE",
]);
