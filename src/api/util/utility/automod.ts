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

import { AuditLog, AutomodRule, Channel, Guild, Member, Message, User, VoiceChannels } from "@spacebar/database";
import { ApiError, Config, emitEvent, ErrorList, FieldError, Permissions, Snowflake } from "@spacebar/util";
import {
    AuditLogEvents,
    AutomodAction,
    AutomodCommonlyFlaggedWordsRule,
    AutomodCustomWordsRule,
    AutomodKeywordPresetType,
    AutomodMentionSpamRule,
    AutomodRuleActionType,
    AutomodRuleEventType,
    AutomodRuleTriggerType,
    ChannelType,
    EmbedType,
    MessageType,
} from "@spacebar/schemas";
import { In, MoreThan } from "typeorm";
import { emitMemberUpdate, mentionRaidActive, postGuildSystemMessage, recordGuildJoin, recordMentionSpam } from "./safety";

export const AUTOMOD_QUARANTINE_FLAGS = 128 | 256 | 1024;
const QUARANTINED_NAME = 128;
const MAX_TIMEOUT_SECONDS = 2419200;

const TRIGGERS: Partial<Record<AutomodRuleTriggerType, { event: AutomodRuleEventType; max: number; actions: AutomodRuleActionType[] }>> = {
    [AutomodRuleTriggerType.KEYWORD]: {
        event: AutomodRuleEventType.MESSAGE_SEND,
        max: 6,
        actions: [AutomodRuleActionType.BLOCK_MESSAGE, AutomodRuleActionType.SEND_ALERT_MESSAGE, AutomodRuleActionType.TIMEOUT_USER],
    },
    [AutomodRuleTriggerType.SPAM]: { event: AutomodRuleEventType.MESSAGE_SEND, max: 1, actions: [AutomodRuleActionType.BLOCK_MESSAGE, AutomodRuleActionType.SEND_ALERT_MESSAGE] },
    [AutomodRuleTriggerType.KEYWORD_PRESET]: {
        event: AutomodRuleEventType.MESSAGE_SEND,
        max: 1,
        actions: [AutomodRuleActionType.BLOCK_MESSAGE, AutomodRuleActionType.SEND_ALERT_MESSAGE],
    },
    [AutomodRuleTriggerType.MENTION_SPAM]: {
        event: AutomodRuleEventType.MESSAGE_SEND,
        max: 1,
        actions: [AutomodRuleActionType.BLOCK_MESSAGE, AutomodRuleActionType.SEND_ALERT_MESSAGE, AutomodRuleActionType.TIMEOUT_USER],
    },
    [AutomodRuleTriggerType.USER_PROFILE]: {
        event: AutomodRuleEventType.GUILD_MEMBER_EVENT,
        max: 1,
        actions: [AutomodRuleActionType.QUARANTINE_USER, AutomodRuleActionType.SEND_ALERT_MESSAGE],
    },
};

const PRESETS: Record<AutomodKeywordPresetType, string[]> = {
    [AutomodKeywordPresetType.PROFANITY]: [
        "fuck*",
        "*fucker*",
        "*fucking*",
        "shit*",
        "bullshit",
        "bitch*",
        "cunt*",
        "asshole*",
        "bastard*",
        "dickhead*",
        "motherfuck*",
        "wanker*",
        "twat*",
        "piss off",
        "prick",
        "douche*",
        "jackass",
        "dumbass",
    ],
    [AutomodKeywordPresetType.SEXUAL_CONTENT]: [
        "porn*",
        "nudes",
        "send nudes",
        "hentai",
        "blowjob*",
        "handjob*",
        "cumshot*",
        "dildo*",
        "onlyfans",
        "xxx",
        "milf*",
        "orgasm*",
        "masturbat*",
        "jerk off",
        "nsfw pics",
        "sex chat",
        "sexting",
        "camgirl*",
    ],
    [AutomodKeywordPresetType.SLURS]: [
        "nigger*",
        "nigga*",
        "faggot*",
        "fag",
        "fags",
        "retard",
        "retards",
        "tranny*",
        "kike*",
        "spic",
        "spics",
        "chink*",
        "gook*",
        "wetback*",
        "raghead*",
        "towelhead*",
        "coon",
        "coons",
        "dyke*",
    ],
};

const HARMFUL_HOSTS = [
    /(^|\.)(dlscord|disc0rd|d1scord|discorcl|dicsord|discrod|disocrd|dscord|discordd|diiscord|discrd|discorb|discord-nitro|discordnitro|discord-gift|discordgift|discord-gifts|discordgifts|nitro-discord|discord-promo|discord-airdrop|discordapp-gift|discord-app\.gift)[a-z0-9-]*\.[a-z.]+$/,
    /(^|\.)(steamcommunlty|steamcommunitly|steamcommuniity|steamcomunity|steamcommnunity|stearncommunity|steancommunity|steamcommunity-[a-z0-9-]+|steam-community|steamconmunity|steamcommuntiy)\.[a-z.]+$/,
    /(^|\.)(free-?nitro|nitro-?free|gift-?nitro|nitro-?gift|nitrogift|giftnitro)[a-z0-9-]*\.[a-z.]+$/,
];
const SCAM_PHRASES = [/free\s+(discord\s+)?nitro/i, /nitro\s+(for\s+)?free/i, /steam\s+(gift|giveaway).*https?:\/\//i, /airdrop.*https?:\/\//i];

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keywordRegex = (keyword: string) => {
    const prefix = keyword.startsWith("*");
    const suffix = keyword.endsWith("*") && keyword.length > 1;
    const core = escapeRegex(keyword.replace(/^\*/, "").replace(/\*$/, "").trim());
    if (!core) return null;
    return new RegExp(`${prefix ? "[\\p{L}\\p{N}_]*" : "(?<![\\p{L}\\p{N}_])"}${core}${suffix ? "[\\p{L}\\p{N}_]*" : "(?![\\p{L}\\p{N}_])"}`, "iu");
};

function matchKeywords(content: string, keywords: string[], patterns: string[], allowList: string[]) {
    const allowed = allowList.map((x) => x.toLowerCase());
    const allowedMatch = (found: string) => allowed.some((entry) => (keywordRegex(entry)?.test(found) ?? false) || entry === found.toLowerCase());
    for (const keyword of keywords) {
        const regex = keywordRegex(keyword);
        const found = regex ? content.match(regex) : null;
        if (found && !allowedMatch(found[0])) return { keyword, content: found[0] };
    }
    for (const pattern of patterns) {
        let regex: RegExp;
        try {
            regex = new RegExp(pattern, "iu");
        } catch {
            continue;
        }
        const found = content.match(regex);
        if (found?.[0] && !allowedMatch(found[0])) return { keyword: pattern, content: found[0] };
    }
    return null;
}

const countMentions = (content: string) => new Set([...content.matchAll(/<@[!&]?(\d+)>/g)].map((x) => x[0].replace("!", ""))).size;

const linkHosts = (content: string) =>
    [...content.matchAll(/https?:\/\/(?:[^\s/@<>]+@)?([^\s/:?#<>]+)/gi)].map((x) => x[1].toLowerCase().replace(/\.$/, "")).filter((host) => host.includes("."));

export function findHarmfulLink(content: string) {
    const extra = Config.get().guild.safety.harmfulLinkDomains.map((domain) => domain.toLowerCase().replace(/^\*\./, ""));
    return linkHosts(content).find((host) => HARMFUL_HOSTS.some((regex) => regex.test(host)) || extra.some((domain) => host === domain || host.endsWith(`.${domain}`))) ?? null;
}

export function assertNoHarmfulLinks(content?: string | null) {
    if (!content || !findHarmfulLink(content)) return;
    throw new ApiError("Your message could not be delivered because it contains a link that has been flagged as harmful.", 200000, 400);
}

async function looksLikeSpam(content: string, opts: { guild_id: string; user_id: string }) {
    if (SCAM_PHRASES.some((regex) => regex.test(content))) return true;
    const normalized = content.trim();
    if (normalized.length < 10 && !linkHosts(normalized).length) return false;
    const repeats = await Message.count({
        where: { guild_id: opts.guild_id, author_id: opts.user_id, content: normalized, timestamp: MoreThan(new Date(Date.now() - 60_000)) },
    });
    return repeats >= 2;
}

interface AutomodMatch {
    rule: AutomodRule;
    keyword: string | null;
    content: string | null;
}

interface MessageContext {
    guild_id: string;
    channel: Channel;
    user_id: string;
    content?: string | null;
    permission?: Permissions;
    message_id?: string;
    title?: boolean;
}

const exempt = (rule: AutomodRule, channels: string[], roles: string[]) =>
    rule.exempt_channels?.some((id) => channels.includes(id)) || rule.exempt_roles?.some((id) => roles.includes(id));

export async function checkAutomod(opts: MessageContext) {
    const content = opts.content ?? "";
    if (!content) return;
    if (opts.permission?.has("ADMINISTRATOR") || opts.permission?.has("MANAGE_GUILD")) return;

    const rules = await AutomodRule.find({ where: { guild_id: opts.guild_id, enabled: true, event_type: AutomodRuleEventType.MESSAGE_SEND }, order: { position: "ASC" } });
    const cached = opts.permission?.cache;
    const member =
        cached?.user_id === opts.user_id && cached.member?.id === opts.user_id && cached.member.guild_id === opts.guild_id && cached.member.roles
            ? cached.member
            : await Member.findOne({ where: { id: opts.user_id, guild_id: opts.guild_id }, relations: { roles: true } });

    if (
        mentionRaidActive(opts.guild_id) &&
        member &&
        Date.now() - new Date(member.joined_at).getTime() < 60 * 60 * 1000 &&
        (countMentions(content) || /@(everyone|here)/.test(content))
    )
        throw new ApiError("Mentions from new members are paused while this server is dealing with suspicious activity.", 200000, 400);
    if (!rules.length) return;

    const roles = member?.roles?.map((x) => x.id) ?? [];
    const parent = opts.channel.parent_id ? await Channel.findOne({ where: { id: opts.channel.parent_id }, select: { id: true, parent_id: true } }) : null;
    const channels = [opts.channel.id, opts.channel.parent_id, parent?.parent_id].filter(Boolean) as string[];

    const matches: AutomodMatch[] = [];
    for (const rule of rules) {
        if (exempt(rule, channels, roles)) continue;
        if (rule.trigger_type === AutomodRuleTriggerType.KEYWORD) {
            const metadata = (rule.trigger_metadata ?? {}) as AutomodCustomWordsRule;
            const found = matchKeywords(content, metadata.keyword_filter ?? [], metadata.regex_patterns ?? [], metadata.allow_list ?? []);
            if (found) matches.push({ rule, ...found });
        } else if (rule.trigger_type === AutomodRuleTriggerType.KEYWORD_PRESET) {
            const metadata = (rule.trigger_metadata ?? {}) as AutomodCommonlyFlaggedWordsRule;
            const found = matchKeywords(
                content,
                (metadata.presets ?? []).flatMap((preset) => PRESETS[preset] ?? []),
                [],
                metadata.allow_list ?? [],
            );
            if (found) matches.push({ rule, ...found });
        } else if (rule.trigger_type === AutomodRuleTriggerType.MENTION_SPAM) {
            const metadata = rule.trigger_metadata as AutomodMentionSpamRule | undefined;
            if (metadata?.mention_total_limit && countMentions(content) > metadata.mention_total_limit) {
                matches.push({ rule, keyword: null, content: null });
                if (metadata.mention_raid_protection_enabled)
                    await recordMentionSpam(opts.guild_id, opts.user_id).catch((e) => console.error("[AutoMod] mention raid check failed", e));
            }
        } else if (rule.trigger_type === AutomodRuleTriggerType.SPAM && !opts.title) {
            if (await looksLikeSpam(content, opts)) matches.push({ rule, keyword: null, content: null });
        }
    }
    if (!matches.length) return;

    const blocking = matches.find((match) => (match.rule.actions as AutomodAction[]).some((action) => action.type === AutomodRuleActionType.BLOCK_MESSAGE));
    const customMessage = blocking
        ? (blocking.rule.actions as AutomodAction[]).find((action) => action.type === AutomodRuleActionType.BLOCK_MESSAGE && action.metadata?.custom_message)?.metadata
        : undefined;

    for (const match of matches) await executeActions(match, { ...opts, content }, !!blocking, member);

    if (blocking)
        throw new ApiError(
            (customMessage as { custom_message?: string } | undefined)?.custom_message ||
                (opts.title
                    ? "Your post could not be created because its title contains content blocked by this server."
                    : "Your message could not be delivered because it contains content blocked by this server."),
            opts.title ? 200001 : 200000,
            400,
        );
}

async function executeActions(match: AutomodMatch, opts: MessageContext & { content: string }, blocked: boolean, member: Member | null) {
    const actions = match.rule.actions as AutomodAction[];
    const timeout = actions.find((action) => action.type === AutomodRuleActionType.TIMEOUT_USER)?.metadata as { duration_seconds?: number } | undefined;
    const decision_id = Snowflake.generate();
    const auditOptions = { channel_id: opts.channel.id, auto_moderation_rule_name: match.rule.name, auto_moderation_rule_trigger_type: String(match.rule.trigger_type) };

    let alert_system_message_id: string | undefined;
    for (const action of actions) {
        if (action.type === AutomodRuleActionType.SEND_ALERT_MESSAGE && action.metadata?.channel_id) {
            const alert = await sendAlert(match, action.metadata.channel_id, {
                guild_id: opts.guild_id,
                user_id: opts.user_id,
                fields: {
                    channel_id: opts.channel.id,
                    decision_id,
                    decision_outcome: blocked ? "blocked" : "flagged",
                    ...(!blocked && opts.message_id ? { flagged_message_id: opts.message_id } : {}),
                    ...(timeout?.duration_seconds && member ? { timeout_duration: String(timeout.duration_seconds) } : {}),
                },
                content: opts.content,
            }).catch((e) => console.error("[AutoMod] alert failed", e));
            if (alert) alert_system_message_id = alert.id;
            await AuditLog.log({
                guild_id: opts.guild_id,
                user_id: opts.user_id,
                action_type: AuditLogEvents.AUTO_MODERATION_FLAG_TO_CHANNEL,
                target_id: opts.user_id,
                options: auditOptions,
            });
        }
        if (action.type === AutomodRuleActionType.TIMEOUT_USER && member && action.metadata?.duration_seconds) {
            await timeoutMember(member, action.metadata.duration_seconds).catch((e) => console.error("[AutoMod] timeout failed", e));
            await AuditLog.log({
                guild_id: opts.guild_id,
                user_id: opts.user_id,
                action_type: AuditLogEvents.AUTO_MODERATION_USER_COMMUNICATION_DISABLE,
                target_id: opts.user_id,
                options: auditOptions,
            });
        }
        if (action.type === AutomodRuleActionType.BLOCK_MESSAGE)
            await AuditLog.log({
                guild_id: opts.guild_id,
                user_id: opts.user_id,
                action_type: AuditLogEvents.AUTO_MODERATION_BLOCK_MESSAGE,
                target_id: opts.user_id,
                options: auditOptions,
            });
    }

    for (const action of actions)
        await emitEvent({
            event: "AUTO_MODERATION_ACTION_EXECUTION",
            guild_id: opts.guild_id,
            data: {
                guild_id: opts.guild_id,
                action: { type: action.type, metadata: action.metadata ?? {} },
                rule_id: match.rule.id,
                rule_trigger_type: match.rule.trigger_type,
                user_id: opts.user_id,
                channel_id: opts.channel.id,
                ...(!blocked && opts.message_id ? { message_id: opts.message_id } : {}),
                ...(alert_system_message_id ? { alert_system_message_id } : {}),
                content: opts.content,
                matched_keyword: match.keyword,
                matched_content: match.content,
            },
        });
}

async function sendAlert(match: AutomodMatch, channel_id: string, opts: { guild_id: string; user_id: string; fields: Record<string, string>; content: string }) {
    const author = await User.findOneOrFail({ where: { id: opts.user_id } });
    const fields = [
        { name: "rule_name", value: match.rule.name, inline: false },
        ...Object.entries(opts.fields).map(([name, value]) => ({ name, value, inline: false })),
        ...(match.keyword ? [{ name: "keyword", value: match.keyword, inline: false }] : []),
        ...(match.content ? [{ name: "keyword_matched_content", value: match.content, inline: false }] : []),
    ];
    return postGuildSystemMessage({
        guild_id: opts.guild_id,
        channel_id,
        author,
        type: MessageType.AUTO_MODERATION_ACTION,
        embeds: [{ type: EmbedType.auto_moderation_message, description: opts.content, fields }],
    });
}

async function timeoutMember(member: Member, seconds: number) {
    const until = new Date(Date.now() + Math.min(seconds, MAX_TIMEOUT_SECONDS) * 1000);
    await Member.update({ id: member.id, guild_id: member.guild_id }, { communication_disabled_until: until });
    await VoiceChannels.move(member.guild_id, member.id, null).catch(() => undefined);
    await emitMemberUpdate(member.guild_id, member.id);
}

export async function checkMemberProfile(guild_id: string, user_id: string, event: "guild_join" | "username_update") {
    const member = await Member.findOne({ where: { id: user_id, guild_id }, relations: { user: true, roles: true } });
    if (!member?.user) return;
    const rules = await AutomodRule.find({
        where: { guild_id, enabled: true, trigger_type: AutomodRuleTriggerType.USER_PROFILE, event_type: AutomodRuleEventType.GUILD_MEMBER_EVENT },
        order: { position: "ASC" },
    });
    const roles = member.roles.map((role) => role.id);
    const guild = await Guild.findOne({ where: { id: guild_id }, select: { id: true, owner_id: true } });
    const elevated = (Permissions.rolePermission(member.roles) & (Permissions.FLAGS.ADMINISTRATOR | Permissions.FLAGS.MANAGE_GUILD)) !== 0n;
    if (guild?.owner_id === user_id || elevated) rules.length = 0;
    const names = Object.entries({ nickname: member.nick, display_name: member.user.global_name, username: member.user.username }).filter(
        (entry): entry is [string, string] => !!entry[1],
    );
    let field = "username";

    let match: AutomodMatch | null = null;
    for (const rule of rules) {
        if (exempt(rule, [], roles)) continue;
        const metadata = (rule.trigger_metadata ?? {}) as AutomodCustomWordsRule;
        for (const [kind, name] of names) {
            const found = matchKeywords(name, metadata.keyword_filter ?? [], metadata.regex_patterns ?? [], metadata.allow_list ?? []);
            if (found) {
                match = { rule, ...found };
                field = kind;
                break;
            }
        }
        if (match) break;
    }

    const quarantine = !!match && (match.rule.actions as AutomodAction[]).some((action) => action.type === AutomodRuleActionType.QUARANTINE_USER);
    const flagged = (member.flags & QUARANTINED_NAME) !== 0;
    if (quarantine !== flagged) {
        await Member.update({ id: user_id, guild_id }, { flags: quarantine ? member.flags | QUARANTINED_NAME : member.flags & ~QUARANTINED_NAME });
        await emitMemberUpdate(guild_id, user_id);
    }
    if (!match) return;

    const decision_id = Snowflake.generate();
    let alert_system_message_id: string | undefined;
    const actions = match.rule.actions as AutomodAction[];
    for (const action of actions) {
        if (action.type === AutomodRuleActionType.SEND_ALERT_MESSAGE && action.metadata?.channel_id) {
            const alert = await sendAlert(match, action.metadata.channel_id, {
                guild_id,
                user_id,
                fields: { decision_id, quarantine_event: event, ...(quarantine ? { quarantine_user: field, quarantine_user_action: "quarantine_user" } : {}) },
                content: names.find(([kind]) => kind === field)?.[1] ?? "",
            }).catch((e) => console.error("[AutoMod] alert failed", e));
            if (alert) alert_system_message_id = alert.id;
        }
        if (action.type === AutomodRuleActionType.QUARANTINE_USER && !flagged)
            await AuditLog.log({
                guild_id,
                user_id,
                action_type: AuditLogEvents.AUTO_MODERATION_QUARANTINE_USER,
                target_id: user_id,
                options: { auto_moderation_rule_name: match.rule.name, auto_moderation_rule_trigger_type: String(match.rule.trigger_type) },
            });
    }
    for (const action of actions)
        await emitEvent({
            event: "AUTO_MODERATION_ACTION_EXECUTION",
            guild_id,
            data: {
                guild_id,
                action: { type: action.type, metadata: action.metadata ?? {} },
                rule_id: match.rule.id,
                rule_trigger_type: match.rule.trigger_type,
                user_id,
                ...(alert_system_message_id ? { alert_system_message_id } : {}),
                content: "",
                matched_keyword: match.keyword,
                matched_content: match.content,
            },
        });
}

export async function onGuildMemberJoin(guild_id: string, user_id: string) {
    await recordGuildJoin(guild_id).catch((e) => console.error("[Safety] raid check failed", e));
    await checkMemberProfile(guild_id, user_id, "guild_join").catch((e) => console.error("[AutoMod] profile check failed", e));
}

export async function checkProfileAcrossGuilds(user_id: string) {
    const guilds = await AutomodRule.find({
        where: {
            enabled: true,
            trigger_type: AutomodRuleTriggerType.USER_PROFILE,
            guild_id: In((await Member.find({ where: { id: user_id }, select: { guild_id: true } })).map((m) => m.guild_id)),
        },
        select: { guild_id: true },
    });
    const flagged = await Member.find({ where: { id: user_id }, select: { guild_id: true, flags: true } });
    const ids = new Set([...guilds.map((rule) => rule.guild_id), ...flagged.filter((m) => (m.flags & QUARANTINED_NAME) !== 0).map((m) => m.guild_id)]);
    for (const guild_id of ids) await checkMemberProfile(guild_id, user_id, "username_update").catch((e) => console.error("[AutoMod] profile check failed", e));
}

type RuleBody = Partial<{
    name: string;
    event_type: number;
    trigger_type: number;
    trigger_metadata: Record<string, unknown> | null;
    actions: { type: number; metadata?: Record<string, unknown> }[];
    enabled: boolean;
    exempt_roles: string[];
    exempt_channels: string[];
    position: number;
}>;

export async function validateAutomodRule(guild_id: string, body: RuleBody, existing?: AutomodRule) {
    const errors: ErrorList = {};
    const fail = (path: string[], code: string, message: string) => {
        let node = errors as Record<string, unknown>;
        for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
        const leaf = (node[path[path.length - 1]] ??= {}) as { _errors?: { code: string; message: string }[] };
        (leaf._errors ??= []).push({ code, message });
    };

    const trigger_type = (existing?.trigger_type ?? body.trigger_type) as AutomodRuleTriggerType;
    const config = TRIGGERS[trigger_type];
    if (existing && body.trigger_type != null && body.trigger_type !== existing.trigger_type)
        fail(["trigger_type"], "AUTO_MODERATION_INVALID_TRIGGER_TYPE", "Trigger type cannot be changed.");
    if (!config) fail(["trigger_type"], "AUTO_MODERATION_INVALID_TRIGGER_TYPE", "Invalid trigger type.");

    const name = (body.name ?? existing?.name ?? "").trim();
    if (!name || name.length > 100) fail(["name"], "BASE_TYPE_BAD_LENGTH", "Must be between 1 and 100 in length.");

    const event_type = body.event_type ?? existing?.event_type ?? config?.event;
    if (config && event_type !== config.event) fail(["event_type"], "AUTO_MODERATION_INVALID_EVENT_TYPE", "Invalid event type for this trigger type.");

    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
    const metadataIn = (body.trigger_metadata !== undefined ? body.trigger_metadata : existing?.trigger_metadata) ?? {};
    let trigger_metadata: Record<string, unknown> = {};
    if (trigger_type === AutomodRuleTriggerType.KEYWORD || trigger_type === AutomodRuleTriggerType.USER_PROFILE) {
        const keyword_filter = strings((metadataIn as Record<string, unknown>).keyword_filter)
            .map((x) => x.trim())
            .filter(Boolean);
        const regex_patterns = strings((metadataIn as Record<string, unknown>).regex_patterns).filter(Boolean);
        const allow_list = strings((metadataIn as Record<string, unknown>).allow_list)
            .map((x) => x.trim())
            .filter(Boolean);
        if (keyword_filter.length > 1000) fail(["trigger_metadata", "keyword_filter"], "BASE_TYPE_MAX_LENGTH", "Must be 1000 or fewer in length.");
        keyword_filter.forEach(
            (keyword, i) => keyword.length > 60 && fail(["trigger_metadata", "keyword_filter", String(i)], "BASE_TYPE_MAX_LENGTH", "Must be 60 or fewer in length."),
        );
        if (regex_patterns.length > 10) fail(["trigger_metadata", "regex_patterns"], "BASE_TYPE_MAX_LENGTH", "Must be 10 or fewer in length.");
        regex_patterns.forEach((pattern, i) => {
            if (pattern.length > 260) return fail(["trigger_metadata", "regex_patterns", String(i)], "BASE_TYPE_MAX_LENGTH", "Must be 260 or fewer in length.");
            try {
                new RegExp(pattern, "iu");
            } catch (e) {
                fail(["trigger_metadata", "regex_patterns", String(i)], "GENERIC_REGEX_ERROR", e instanceof Error ? e.message : "Invalid regex.");
            }
        });
        if (allow_list.length > 100) fail(["trigger_metadata", "allow_list"], "BASE_TYPE_MAX_LENGTH", "Must be 100 or fewer in length.");
        trigger_metadata = { keyword_filter, regex_patterns, allow_list };
    } else if (trigger_type === AutomodRuleTriggerType.KEYWORD_PRESET) {
        const presets = ((metadataIn as Record<string, unknown>).presets as unknown[] | undefined)?.filter((x): x is number => [1, 2, 3].includes(x as number)) ?? [];
        const allow_list = strings((metadataIn as Record<string, unknown>).allow_list)
            .map((x) => x.trim())
            .filter(Boolean);
        if (allow_list.length > 1000) fail(["trigger_metadata", "allow_list"], "BASE_TYPE_MAX_LENGTH", "Must be 1000 or fewer in length.");
        trigger_metadata = { presets: [...new Set(presets)], allow_list };
    } else if (trigger_type === AutomodRuleTriggerType.MENTION_SPAM) {
        const limit = Number((metadataIn as Record<string, unknown>).mention_total_limit ?? 20);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(["trigger_metadata", "mention_total_limit"], "NUMBER_TYPE_MAX", "Must be between 1 and 50.");
        trigger_metadata = { mention_total_limit: limit, mention_raid_protection_enabled: !!(metadataIn as Record<string, unknown>).mention_raid_protection_enabled };
    }

    const actionsIn = body.actions ?? (existing?.actions as RuleBody["actions"]) ?? [];
    if (!Array.isArray(actionsIn) || !actionsIn.length) fail(["actions"], "BASE_TYPE_MIN_LENGTH", "Must be 1 or more in length.");
    const actions: AutomodAction[] = [];
    const alertChannels = (Array.isArray(actionsIn) ? actionsIn : [])
        .filter((action) => action?.type === AutomodRuleActionType.SEND_ALERT_MESSAGE)
        .map((action) => String(action.metadata?.channel_id ?? ""));
    const validChannels = new Set(
        alertChannels.length
            ? (
                  await Channel.find({
                      where: { guild_id, id: In(alertChannels.filter((id) => /^\d{1,20}$/.test(id))) },
                      select: { id: true, type: true },
                  })
              )
                  .filter((channel) => [ChannelType.GUILD_TEXT, ChannelType.GUILD_NEWS].includes(channel.type))
                  .map((channel) => channel.id)
            : [],
    );
    (Array.isArray(actionsIn) ? actionsIn : []).forEach((action, i) => {
        const type = action?.type as AutomodRuleActionType;
        if (!config?.actions.includes(type)) return fail(["actions", String(i), "type"], "AUTO_MODERATION_INVALID_ACTION_TYPE", "Invalid action type for this trigger type.");
        const metadata = action.metadata ?? {};
        if (type === AutomodRuleActionType.BLOCK_MESSAGE) {
            const custom_message = typeof metadata.custom_message === "string" ? metadata.custom_message.trim() : "";
            if (custom_message.length > 150) fail(["actions", String(i), "metadata", "custom_message"], "BASE_TYPE_MAX_LENGTH", "Must be 150 or fewer in length.");
            actions.push({ type, metadata: custom_message ? { custom_message } : {} });
        } else if (type === AutomodRuleActionType.SEND_ALERT_MESSAGE) {
            const channel_id = String(metadata.channel_id ?? "");
            if (!validChannels.has(channel_id)) fail(["actions", String(i), "metadata", "channel_id"], "AUTO_MODERATION_INVALID_CHANNEL", "Invalid alert channel.");
            actions.push({ type, metadata: { channel_id } });
        } else if (type === AutomodRuleActionType.TIMEOUT_USER) {
            const duration_seconds = Number(metadata.duration_seconds);
            if (!Number.isInteger(duration_seconds) || duration_seconds < 1 || duration_seconds > MAX_TIMEOUT_SECONDS)
                fail(["actions", String(i), "metadata", "duration_seconds"], "NUMBER_TYPE_MAX", "Must be between 1 and 2419200.");
            actions.push({ type, metadata: { duration_seconds } });
        } else actions.push({ type, metadata: {} } as AutomodAction);
    });

    const exempt_roles = [...new Set(strings(body.exempt_roles ?? existing?.exempt_roles))];
    const exempt_channels = [...new Set(strings(body.exempt_channels ?? existing?.exempt_channels))];
    if (exempt_roles.length > 20) fail(["exempt_roles"], "BASE_TYPE_MAX_LENGTH", "Must be 20 or fewer in length.");
    if (exempt_channels.length > 50) fail(["exempt_channels"], "BASE_TYPE_MAX_LENGTH", "Must be 50 or fewer in length.");

    if (!existing && config) {
        const count = await AutomodRule.count({ where: { guild_id, trigger_type } });
        if (count >= config.max) fail(["trigger_type"], "AUTO_MODERATION_MAX_RULES_OF_TYPE_EXCEEDED", `Maximum number of rules of this type reached (${config.max}).`);
    }

    if (Object.keys(errors).length) throw new FieldError(50035, "Invalid Form Body", errors);

    return {
        name,
        event_type: event_type as AutomodRuleEventType,
        trigger_type,
        trigger_metadata: trigger_metadata as AutomodRule["trigger_metadata"],
        actions,
        enabled: body.enabled ?? existing?.enabled ?? false,
        exempt_roles,
        exempt_channels,
    };
}
