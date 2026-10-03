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

import { Channel, Guild, GuildIncidentsData, Member, Message, User } from "@spacebar/database";
import { Config, DiscordApiErrors, emitEvent, GuildMemberUpdateEvent, MessageCreateEvent, Snowflake } from "@spacebar/util";
import { Embed, EmbedType, MessageType } from "@spacebar/schemas";
import { getSystemAccount } from "./systemAccounts";

const EMPTY_INCIDENTS: GuildIncidentsData = { invites_disabled_until: null, dms_disabled_until: null, dm_spam_detected_at: null, raid_detected_at: null };
const ALERT_COOLDOWN = 60 * 60 * 1000;

const joinLog = new Map<string, number[]>();
const dmLog = new Map<string, { at: number; sender: string; recipient: string }[]>();
const mentionLog = new Map<string, { at: number; user_id: string }[]>();
const mentionRaids = new Map<string, number>();

export async function emitMemberUpdate(guild_id: string, user_id: string) {
    const updated = await Member.findOneOrFail({ where: { id: user_id, guild_id }, relations: { user: true, roles: true } });
    await emitEvent({
        event: "GUILD_MEMBER_UPDATE",
        guild_id,
        data: {
            ...updated.toPublicMember(),
            guild_id,
            user: updated.user.toPublicUser(),
            roles: updated.roles.map((x) => x.id).filter((id) => id !== guild_id),
        },
    } satisfies GuildMemberUpdateEvent);
}

const prune = <T>(entries: T[], since: number, at: (entry: T) => number) => entries.filter((entry) => at(entry) >= since);

export async function postGuildSystemMessage(opts: { guild_id: string; channel_id: string; author: User; type: MessageType; content?: string; embeds?: Embed[] }) {
    if (!(await Channel.exists({ where: { id: opts.channel_id, guild_id: opts.guild_id } }))) return null;
    const message = Message.create({
        type: opts.type,
        guild_id: opts.guild_id,
        channel_id: opts.channel_id,
        author: opts.author,
        content: opts.content ?? "",
        timestamp: new Date(),
        reactions: [],
        attachments: [],
        embeds: opts.embeds ?? [],
        sticker_items: [],
        edited_timestamp: undefined,
        mentions: [],
        mention_channels: [],
        mention_roles: [],
        mention_everyone: false,
    });
    await message.insert();
    await Promise.all([
        emitEvent({ event: "MESSAGE_CREATE", channel_id: opts.channel_id, data: message.toJSON() } satisfies MessageCreateEvent),
        Channel.update({ id: opts.channel_id }, { last_message_id: message.id }),
    ]);
    return message;
}

export const safetyChannelId = (guild: Pick<Guild, "safety_alerts_channel_id" | "public_updates_channel_id">) =>
    guild.safety_alerts_channel_id ?? guild.public_updates_channel_id ?? null;

const raidAlertsEnabled = (guild: Guild) =>
    !guild.features.includes("RAID_ALERTS_DISABLED") &&
    (guild.features.includes("COMMUNITY") || guild.features.includes("NON_COMMUNITY_RAID_ALERTS") || !!guild.safety_alerts_channel_id);

async function notify(guild: Guild, fields: Record<string, string>) {
    const channel_id = safetyChannelId(guild);
    if (!channel_id || !raidAlertsEnabled(guild)) return null;
    return postGuildSystemMessage({
        guild_id: guild.id,
        channel_id,
        author: await getSystemAccount("official"),
        type: MessageType.AUTO_MODERATION_ACTION,
        embeds: [{ type: EmbedType.auto_moderation_notification, fields: Object.entries(fields).map(([name, value]) => ({ name, value, inline: false })) }],
    });
}

async function flagIncident(guild_id: string, key: "raid_detected_at" | "dm_spam_detected_at", fields: Record<string, string>) {
    const guild = await Guild.findOne({ where: { id: guild_id } });
    if (!guild) return;
    const previous = guild.incidents_data?.[key];
    if (previous && Date.now() - new Date(previous).getTime() < ALERT_COOLDOWN) return;
    const now = new Date().toISOString();
    guild.incidents_data = { ...EMPTY_INCIDENTS, ...guild.incidents_data, [key]: now };
    await Guild.update({ id: guild_id }, { incidents_data: guild.incidents_data });
    await Guild.emitUpdate(guild_id);
    await notify(guild, { notification_type: "raid", raid_datetime: now, decision_id: Snowflake.generate(), ...fields });
}

export async function recordGuildJoin(guild_id: string) {
    const { raidJoinThreshold, raidJoinWindowSeconds } = Config.get().guild.safety;
    if (!raidJoinThreshold) return;
    const now = Date.now();
    const joins = [...prune(joinLog.get(guild_id) ?? [], now - raidJoinWindowSeconds * 1000, (at) => at), now];
    joinLog.set(guild_id, joins);
    if (joins.length >= raidJoinThreshold) await flagIncident(guild_id, "raid_detected_at", { raid_type: "join_raid", join_attempts: String(joins.length) });
}

export async function recordGuildMemberDm(guild_ids: string[], sender: string, recipient: string) {
    const { dmRaidThreshold, dmRaidWindowSeconds } = Config.get().guild.safety;
    if (!dmRaidThreshold) return;
    const now = Date.now();
    for (const guild_id of guild_ids) {
        const entries = [...prune(dmLog.get(guild_id) ?? [], now - dmRaidWindowSeconds * 1000, (entry) => entry.at), { at: now, sender, recipient }];
        dmLog.set(guild_id, entries);
        const fromSender = new Set(entries.filter((entry) => entry.sender === sender).map((entry) => entry.recipient));
        if (fromSender.size < dmRaidThreshold) continue;
        await Member.update({ id: sender, guild_id }, { unusual_dm_activity_until: new Date(now + 24 * 60 * 60 * 1000) });
        await emitMemberUpdate(guild_id, sender).catch(() => undefined);
        await flagIncident(guild_id, "dm_spam_detected_at", { raid_type: "dm_raid", dms_sent: String(fromSender.size) });
    }
}

export function mentionRaidActive(guild_id: string) {
    const until = mentionRaids.get(guild_id);
    if (until && until > Date.now()) return true;
    mentionRaids.delete(guild_id);
    return false;
}

export function clearMentionRaid(guild_id: string) {
    mentionRaids.delete(guild_id);
    mentionLog.delete(guild_id);
}

export async function recordMentionSpam(guild_id: string, user_id: string) {
    const { mentionRaidThreshold, mentionRaidWindowSeconds } = Config.get().guild.safety;
    if (!mentionRaidThreshold) return;
    const now = Date.now();
    const entries = [...prune(mentionLog.get(guild_id) ?? [], now - mentionRaidWindowSeconds * 1000, (entry) => entry.at), { at: now, user_id }];
    mentionLog.set(guild_id, entries);
    if (new Set(entries.map((entry) => entry.user_id)).size < mentionRaidThreshold || mentionRaidActive(guild_id)) return;

    const until = new Date(now + ALERT_COOLDOWN);
    const decision_id = Snowflake.generate();
    mentionRaids.set(guild_id, until.getTime());
    await emitEvent({
        event: "AUTO_MODERATION_MENTION_RAID_DETECTION",
        guild_id,
        data: { guild_id, decision_id, suspicious_mention_activity_until: until.toISOString() },
    });
    const guild = await Guild.findOne({ where: { id: guild_id } });
    if (guild) await notify(guild, { notification_type: "mention_raid", decision_id, suspicious_mention_activity_until: until.toISOString() });
}

const BYPASSES_VERIFICATION = 1 << 2;

export async function assertGuildVerification(guild_id: string, user_id: string) {
    const guild = await Guild.findOne({ where: { id: guild_id }, select: { id: true, owner_id: true, verification_level: true } });
    const level = guild?.verification_level ?? 0;
    if (!guild || !level || guild.owner_id === user_id) return;
    const [user, member] = await Promise.all([
        User.findOne({ where: { id: user_id }, select: { id: true, bot: true, verified: true, phone: true } }),
        Member.findOne({
            where: { id: user_id, guild_id },
            relations: { roles: true },
            select: { index: true, id: true, guild_id: true, joined_at: true, flags: true, roles: { id: true } },
        }),
    ]);
    if (!user || user.bot || !member) return;
    if ((member.flags & BYPASSES_VERIFICATION) !== 0 || member.roles.some((role) => role.id !== guild_id)) return;
    const accountAge = Date.now() - Snowflake.deconstruct(user.id).timestamp;
    const memberAge = Date.now() - new Date(member.joined_at).getTime();
    if ((level >= 1 && !user.verified) || (level >= 2 && accountAge < 5 * 60 * 1000) || (level >= 3 && memberAge < 10 * 60 * 1000) || (level >= 4 && !user.phone))
        throw DiscordApiErrors.CHANNEL_VERIFICATION_LEVEL_TOO_HIGH;
}

export async function assertCanInteract(guild_id: string, user_id: string) {
    const member = await Member.findOne({ where: { id: user_id, guild_id }, select: { index: true, id: true, guild_id: true, communication_disabled_until: true, flags: true } });
    if (!member) return;
    if (member.communication_disabled_until && new Date(member.communication_disabled_until).getTime() > Date.now())
        throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("ADD_REACTIONS");
    if ((member.flags & (128 | 256 | 1024)) !== 0) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("ADD_REACTIONS");
}
