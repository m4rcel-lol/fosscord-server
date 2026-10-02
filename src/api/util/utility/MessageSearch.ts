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

import { HTTPError } from "lambert-server/HTTPError";
import { Brackets, In } from "typeorm";
import { Channel, Message, Recipient } from "@spacebar/database";
import { FieldErrors, getPermission } from "@spacebar/util";

export type MessageSearchQuery = Record<string, unknown>;

const HAS_FILTERS: Record<string, string> = {
    link: `m.content ~* 'https?://'`,
    embed: `jsonb_array_length(m.embeds) > 0`,
    file: `EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)`,
    image: `(EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%') OR m.embeds @> '[{"type":"image"}]' OR m.embeds @> '[{"type":"gifv"}]')`,
    video: `(EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'video/%') OR m.embeds @> '[{"type":"video"}]')`,
    sound: `EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'audio/%')`,
    sticker: `EXISTS (SELECT 1 FROM message_stickers s WHERE s.message_id = m.id)`,
    poll: `m.poll IS NOT NULL`,
    forward: `m.message_reference->>'type' = '1'`,
    snapshot: `jsonb_array_length(m.message_snapshots) > 0`,
};

const list = (value: unknown): string[] => (value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]).map(String).filter((x) => x.length));

const bool = (value: unknown) => (value === undefined ? undefined : value === true || value === "true");

export async function getSearchableChannels(userId: string, guildId: string | undefined, channelIds: string[]) {
    const candidates = guildId
        ? await Channel.find({ where: { guild_id: guildId, ...(channelIds.length ? { id: In(channelIds) } : {}) }, select: { id: true, guild_id: true, nsfw: true } })
        : (await Recipient.find({ where: { user_id: userId, ...(channelIds.length ? { channel_id: In(channelIds) } : {}) }, select: { channel_id: true } })).map(({ channel_id }) =>
              Channel.create({ id: channel_id }),
          );
    const allowed = await Promise.all(
        candidates.map(async (channel) => {
            const permission = await getPermission(userId, guildId, channel.id);
            return permission.has("VIEW_CHANNEL") && permission.has("READ_MESSAGE_HISTORY") ? channel : undefined;
        }),
    );
    return allowed.filter((channel): channel is Channel => !!channel);
}

export async function searchMessages(userId: string, channels: Channel[], query: MessageSearchQuery) {
    const limit = Number(query.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HTTPError("limit must be between 1 and 100", 422);
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const sortOrder = `${query.sort_order ?? "desc"}`.toLowerCase();
    if (sortOrder !== "desc" && sortOrder !== "asc") throw FieldErrors({ sort_order: { message: "Value must be one of ('desc', 'asc').", code: "BASE_TYPE_CHOICES" } });

    const includeNsfw = bool(query.include_nsfw) ?? false;
    const channelIds = channels.filter((channel) => includeNsfw || !channel.nsfw).map((channel) => channel.id);
    if (!channelIds.length) return { messages: [] as Message[], total_results: 0 };

    const qb = Message.createQueryBuilder("m").select("m.id", "id").where("m.channel_id IN (:...channelIds)", { channelIds });

    const words = `${query.content ?? ""}`
        .trim()
        .split(/\s+/)
        .filter((word) => word.length);
    words.forEach((word, i) => qb.andWhere(`m.content ILIKE :word${i}`, { [`word${i}`]: `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%` }));

    const authors = list(query.author_id);
    if (authors.length) qb.andWhere("m.author_id IN (:...authors)", { authors });

    for (const type of list(query.author_type)) {
        const negate = type.startsWith("-");
        const kind = type.replace(/^-/, "");
        const clause =
            kind === "webhook"
                ? "m.webhook_id IS NOT NULL"
                : kind === "bot"
                  ? "EXISTS (SELECT 1 FROM users u WHERE u.id = m.author_id AND u.bot = true) AND m.webhook_id IS NULL"
                  : kind === "user"
                    ? "EXISTS (SELECT 1 FROM users u WHERE u.id = m.author_id AND u.bot = false) AND m.webhook_id IS NULL"
                    : undefined;
        if (clause) qb.andWhere(negate ? `NOT (${clause})` : clause);
    }

    const mentions = list(query.mentions);
    if (mentions.length)
        qb.andWhere(
            new Brackets((b) =>
                b
                    .where("EXISTS (SELECT 1 FROM message_user_mentions mu WHERE mu.message_id = m.id AND mu.user_id IN (:...mentions))", { mentions })
                    .orWhere("m.mention_everyone = true"),
            ),
        );
    if (bool(query.mention_everyone) !== undefined) qb.andWhere("COALESCE(m.mention_everyone, false) = :everyone", { everyone: bool(query.mention_everyone) });

    const has = list(query.has);
    const wanted = has.filter((x) => !x.startsWith("-")).flatMap((x) => HAS_FILTERS[x] ?? []);
    if (wanted.length) qb.andWhere(`(${wanted.join(" OR ")})`);
    for (const clause of has.filter((x) => x.startsWith("-")).flatMap((x) => HAS_FILTERS[x.slice(1)] ?? [])) qb.andWhere(`NOT (${clause})`);

    const pinned = bool(query.pinned);
    if (pinned !== undefined) qb.andWhere(pinned ? "m.pinned_at IS NOT NULL" : "m.pinned_at IS NULL");
    if (query.min_id) qb.andWhere("m.id > :minId", { minId: `${query.min_id}` });
    if (query.max_id) qb.andWhere("m.id < :maxId", { maxId: `${query.max_id}` });

    const total_results = await qb.getCount();
    const ids = (
        await qb
            .orderBy("m.id", sortOrder === "asc" ? "ASC" : "DESC")
            .offset(offset)
            .limit(limit)
            .getRawMany<{ id: string }>()
    ).map(({ id }) => `${id}`);

    const found = ids.length
        ? await Message.find({
              where: { id: In(ids) },
              relations: { author: true, webhook: true, application: true, mentions: true, mention_roles: true, mention_channels: true, sticker_items: true, attachments: true },
          })
        : [];
    await Message.fillReplies(found);
    const messages = ids.map((id) => found.find((message) => message.id === id)).filter((message): message is Message => !!message);
    return { messages, total_results };
}

export function searchResponse(userId: string, result: { messages: Message[]; total_results: number }) {
    return {
        analytics_id: null,
        doing_deep_historical_index: false,
        total_results: result.total_results,
        messages: result.messages.map((message) => [{ ...message.toJSON(), reactions: Message.publicReactions(message.reactions, userId), hit: true }]),
        threads: [],
        members: [],
    };
}

export async function searchTabs(userId: string, channels: Channel[], body: { tabs?: Record<string, MessageSearchQuery>; include_nsfw?: boolean }) {
    const tabs: Record<string, unknown> = {};
    for (const [name, query] of Object.entries(body.tabs ?? {})) {
        const result = await searchMessages(userId, channels, { include_nsfw: body.include_nsfw, ...query });
        const response = searchResponse(userId, result);
        tabs[name] = { ...response, cursor: null };
    }
    return { tabs, analytics_id: null, doing_deep_historical_index: false };
}
