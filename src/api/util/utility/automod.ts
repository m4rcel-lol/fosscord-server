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

import { AutomodRule, Channel, Member, Message, User } from "@spacebar/database";
import { ApiError, emitEvent, GuildMemberUpdateEvent, MessageCreateEvent, Permissions, Snowflake } from "@spacebar/util";
import {
    AutomodAction,
    AutomodCustomWordsRule,
    AutomodMentionSpamRule,
    AutomodRuleActionType,
    AutomodRuleEventType,
    AutomodRuleTriggerType,
    EmbedType,
    MessageType,
} from "@spacebar/schemas";

interface AutomodMatch {
    rule: AutomodRule;
    keyword: string | null;
    content: string | null;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keywordRegex = (keyword: string) => {
    const prefix = keyword.startsWith("*");
    const suffix = keyword.endsWith("*") && keyword.length > 1;
    const core = escapeRegex(keyword.replace(/^\*/, "").replace(/\*$/, ""));
    if (!core) return null;
    return new RegExp(`${prefix ? "[\\p{L}\\p{N}_]*" : "(?<![\\p{L}\\p{N}_])"}${core}${suffix ? "[\\p{L}\\p{N}_]*" : "(?![\\p{L}\\p{N}_])"}`, "iu");
};

function matchKeywords(content: string, metadata: AutomodCustomWordsRule) {
    const allowed = (metadata.allow_list ?? []).map((x) => x.toLowerCase());
    for (const keyword of metadata.keyword_filter ?? []) {
        const regex = keywordRegex(keyword);
        const found = regex ? content.match(regex) : null;
        if (found && !allowed.includes(found[0].toLowerCase())) return { keyword, content: found[0] };
    }
    for (const pattern of metadata.regex_patterns ?? []) {
        let regex: RegExp;
        try {
            regex = new RegExp(pattern, "iu");
        } catch {
            continue;
        }
        const found = content.match(regex);
        if (found && !allowed.includes(found[0].toLowerCase())) return { keyword: pattern, content: found[0] };
    }
    return null;
}

function countMentions(content: string) {
    return new Set([...content.matchAll(/<@[!&]?(\d+)>/g)].map((x) => x[0].replace("!", ""))).size;
}

export async function checkAutomod(opts: { guild_id: string; channel: Channel; user_id: string; content?: string | null; permission?: Permissions }) {
    const content = opts.content ?? "";
    if (!content) return;
    if (opts.permission?.has("ADMINISTRATOR") || opts.permission?.has("MANAGE_GUILD")) return;

    const rules = await AutomodRule.find({ where: { guild_id: opts.guild_id, enabled: true, event_type: AutomodRuleEventType.MESSAGE_SEND }, order: { position: "ASC" } });
    if (!rules.length) return;

    const member = await Member.findOne({ where: { id: opts.user_id, guild_id: opts.guild_id }, relations: { roles: true } });
    const roles = member?.roles?.map((x) => x.id) ?? [];
    const channels = [opts.channel.id, opts.channel.parent_id].filter(Boolean) as string[];

    const matches: AutomodMatch[] = [];
    for (const rule of rules) {
        if (rule.exempt_channels?.some((id) => channels.includes(id))) continue;
        if (rule.exempt_roles?.some((id) => roles.includes(id))) continue;

        if (rule.trigger_type === AutomodRuleTriggerType.KEYWORD) {
            const found = matchKeywords(content, (rule.trigger_metadata ?? {}) as AutomodCustomWordsRule);
            if (found) matches.push({ rule, ...found });
        } else if (rule.trigger_type === AutomodRuleTriggerType.MENTION_SPAM) {
            const limit = (rule.trigger_metadata as AutomodMentionSpamRule | undefined)?.mention_total_limit;
            if (limit && countMentions(content) > limit) matches.push({ rule, keyword: null, content: null });
        }
    }
    if (!matches.length) return;

    let blocked: AutomodMatch | null = null;
    let customMessage: string | undefined;
    for (const match of matches) {
        for (const action of match.rule.actions as AutomodAction[]) {
            if (action.type === AutomodRuleActionType.BLOCK_MESSAGE) {
                blocked ??= match;
                customMessage ??= action.metadata?.custom_message || undefined;
            }
        }
    }

    for (const match of matches) {
        for (const action of match.rule.actions as AutomodAction[]) {
            if (action.type === AutomodRuleActionType.SEND_ALERT_MESSAGE && action.metadata?.channel_id)
                await sendAlert(match, action.metadata.channel_id, opts, content, !!blocked).catch((e) => console.error("[AutoMod] alert failed", e));
            if (action.type === AutomodRuleActionType.TIMEOUT_USER && member && action.metadata?.duration_seconds)
                await timeoutMember(member, action.metadata.duration_seconds).catch((e) => console.error("[AutoMod] timeout failed", e));
        }
    }

    if (blocked) throw new ApiError(customMessage ?? "Your message could not be delivered because it contains content blocked by this server.", 200000, 400);
}

async function sendAlert(match: AutomodMatch, channel_id: string, opts: { guild_id: string; channel: Channel; user_id: string }, content: string, blocked: boolean) {
    if (!(await Channel.exists({ where: { id: channel_id, guild_id: opts.guild_id } }))) return;
    const author = await User.findOneOrFail({ where: { id: opts.user_id } });
    const fields = [
        { name: "rule_name", value: match.rule.name, inline: false },
        { name: "channel_id", value: opts.channel.id, inline: false },
        { name: "decision_id", value: Snowflake.generate(), inline: false },
        { name: "decision_outcome", value: blocked ? "blocked" : "flagged", inline: false },
        ...(match.keyword ? [{ name: "keyword", value: match.keyword, inline: false }] : []),
        ...(match.content ? [{ name: "keyword_matched_content", value: match.content, inline: false }] : []),
    ];
    const message = Message.create({
        type: MessageType.AUTO_MODERATION_ACTION,
        guild_id: opts.guild_id,
        channel_id,
        author,
        content: "",
        timestamp: new Date(),
        reactions: [],
        attachments: [],
        embeds: [{ type: EmbedType.auto_moderation_message, description: content, fields }],
        sticker_items: [],
        edited_timestamp: undefined,
        mentions: [],
        mention_channels: [],
        mention_roles: [],
        mention_everyone: false,
    });
    await message.insert();
    await Promise.all([
        emitEvent({ event: "MESSAGE_CREATE", channel_id, data: message.toJSON() } satisfies MessageCreateEvent),
        Channel.update({ id: channel_id }, { last_message_id: message.id }),
    ]);
}

async function timeoutMember(member: Member, seconds: number) {
    const until = new Date(Date.now() + Math.min(seconds, 2419200) * 1000);
    await Member.update({ id: member.id, guild_id: member.guild_id }, { communication_disabled_until: until });
    const updated = await Member.findOneOrFail({ where: { id: member.id, guild_id: member.guild_id }, relations: { user: true, roles: true } });
    await emitEvent({
        event: "GUILD_MEMBER_UPDATE",
        guild_id: member.guild_id,
        data: {
            ...updated.toPublicMember(),
            guild_id: member.guild_id,
            user: updated.user.toPublicUser(),
            roles: updated.roles.map((x) => x.id).filter((id) => id !== member.guild_id),
        },
    } satisfies GuildMemberUpdateEvent);
}
