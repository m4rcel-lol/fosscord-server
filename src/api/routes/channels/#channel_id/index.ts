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

import { Request, Response, Router } from "express";
import { Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { AUTO_ARCHIVE_DURATION_ERROR, AUTO_ARCHIVE_DURATIONS, emitThreadUpdate, sendMessage, setThreadArchived } from "@spacebar/api/util";
import { AuditLog, Channel, Guild, Recipient, Tag, ThreadMember, VoiceChannels } from "@spacebar/database";
import {
    ChannelDeleteEvent,
    ChannelFlags,
    ChannelUpdateEvent,
    Config,
    DiscordApiErrors,
    DmChannelDTO,
    emitEvent,
    ErrorList,
    FieldError,
    FieldErrors,
    handleFile,
    makeObjectErrorContent,
    Snowflake,
    ThreadDeleteEvent,
} from "@spacebar/util";
import { AuditLogEvents, ChannelModifySchema, ChannelType, MessageType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            200: {
                body: "Channel",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { available_tags: true, recipients: true },
        });
        if (channel.isDm()) {
            const recipient = channel.recipients?.find((r) => r.user_id === req.user_id);
            return res.send({
                ...(await DmChannelDTO.from(channel, [req.user_id])),
                last_pin_timestamp: channel.last_pin_timestamp?.toISOString() ?? undefined,
                is_spam: false,
                is_message_request: !!recipient?.message_request_timestamp,
                is_message_request_timestamp: recipient?.message_request_timestamp?.toISOString() ?? null,
            });
        }
        if (!channel.guild_id) return res.send(channel.toJSON());
        if (channel.isThread()) {
            const member = await ThreadMember.findOne({ where: { id: channel.id, user_id: req.user_id } });
            return res.send({ ...channel.toJSON(), ...(member ? { member: member.toJSON() } : {}) });
        }

        channel.position = await Channel.calculatePosition(channel_id, channel.guild_id, channel.guild);
        return res.send(channel);
    },
);

router.delete(
    "/",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            200: {
                body: "Channel",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { recipients: true },
        });

        if (channel.type === ChannelType.DM) {
            const recipient = await Recipient.findOneOrFail({
                where: { channel_id: channel_id, user_id: req.user_id },
            });
            recipient.closed = true;
            await Promise.all([
                recipient.save(),
                emitEvent({
                    event: "CHANNEL_DELETE",
                    data: channel.toJSON(),
                    user_id: req.user_id,
                } satisfies ChannelDeleteEvent),
            ]);
        } else if (channel.type === ChannelType.GROUP_DM) {
            await Channel.removeRecipientFromChannel(channel, req.user_id);
            return res.send(await DmChannelDTO.from(channel));
        } else if (channel.isThread()) {
            req.permission!.hasThrow("MANAGE_THREADS");
            const data = { id: channel_id, guild_id: channel.guild_id, parent_id: channel.parent_id, type: channel.type };
            const transaction_id = Snowflake.generate();
            await Channel.delete({ id: channel_id });
            await AuditLog.log({
                guild_id: channel.guild_id!,
                user_id: req.user_id,
                action_type: AuditLogEvents.THREAD_DELETE,
                target_id: channel_id,
                changes: AuditLog.diff(threadAuditState(channel), {}, AuditLog.threadKeys),
                reason: req.headers["x-audit-log-reason"],
            });
            await emitEvent({ event: "THREAD_DELETE", data, channel_id, transaction_id } satisfies ThreadDeleteEvent);
            if (!channel.isPrivateThread()) await emitEvent({ event: "THREAD_DELETE", data, channel_id: channel.parent_id!, transaction_id } satisfies ThreadDeleteEvent);
        } else {
            req.permission!.hasThrow("MANAGE_CHANNELS");
            if (channel.type == ChannelType.GUILD_CATEGORY) {
                const channels = await Channel.find({
                    where: { parent_id: channel_id },
                });
                for await (const c of channels) {
                    c.parent_id = null;

                    await Promise.all([
                        Channel.update({ id: c.id }, { parent_id: null }),
                        emitEvent({
                            event: "CHANNEL_UPDATE",
                            data: c.toJSON(),
                            channel_id: c.id,
                        } satisfies ChannelUpdateEvent),
                    ]);
                }
            }

            if (channel.guild_id && [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE].includes(channel.type)) await VoiceChannels.evict(channel.guild_id, channel_id);
            await Channel.deleteChannel(channel);
            if (channel.guild_id)
                await AuditLog.log({
                    guild_id: channel.guild_id,
                    user_id: req.user_id,
                    action_type: AuditLogEvents.CHANNEL_DELETE,
                    target_id: channel_id,
                    changes: AuditLog.diff(channel, {}, AuditLog.channelKeys),
                    reason: req.headers["x-audit-log-reason"],
                });
            await emitEvent({
                event: "CHANNEL_DELETE",
                data: channel.toJSON(),
                channel_id,
            } satisfies ChannelDeleteEvent);
        }

        res.send(channel);
    },
);

const THREAD_FIELDS = ["archived", "locked", "auto_archive_duration", "invitable"] as const;

const threadAuditState = (channel: Channel) => ({
    name: channel.name,
    type: channel.type,
    archived: channel.thread_metadata?.archived,
    locked: channel.thread_metadata?.locked,
    auto_archive_duration: channel.thread_metadata?.auto_archive_duration,
    invitable: channel.thread_metadata?.invitable,
    rate_limit_per_user: channel.rate_limit_per_user,
    flags: channel.flags,
    applied_tags: channel.applied_tags,
});

router.patch(
    "/",
    route({
        requestBody: "ChannelModifySchema",
        permission: "VIEW_CHANNEL",
        responses: {
            200: {
                body: "Channel",
            },
            404: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const payload = req.body as ChannelModifySchema;
        const { channel_id } = req.params as { [key: string]: string };
        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { available_tags: true },
        });

        const channelLimits = Config.get().limits.channel;
        const errors: ErrorList = {};
        const maxName = channel.isThread() ? 100 : channelLimits.maxName;
        if (payload.name !== undefined && (payload.name.length < 1 || payload.name.length > maxName))
            errors["name"] = makeObjectErrorContent("BASE_TYPE_BAD_LENGTH", `Must be between 1 and ${maxName} in length.`);
        if (channel.isThread() && payload.auto_archive_duration != null && !AUTO_ARCHIVE_DURATIONS.includes(Number(payload.auto_archive_duration)))
            errors["auto_archive_duration"] = makeObjectErrorContent(AUTO_ARCHIVE_DURATION_ERROR.code, AUTO_ARCHIVE_DURATION_ERROR.message);
        if (payload.topic && payload.topic.length > (channel.isForum() ? 4096 : channelLimits.maxTopic))
            errors["topic"] = makeObjectErrorContent("BASE_TYPE_BAD_LENGTH", `Must be ${channel.isForum() ? 4096 : channelLimits.maxTopic} or fewer in length.`);
        if (payload.user_limit !== undefined && payload.user_limit < 0) errors["user_limit"] = makeObjectErrorContent("BASE_TYPE_BAD_VALUE", "User limit must be 0 or higher");
        if (Object.keys(errors).length) throw new FieldError(50035, "Invalid Form Body", errors);

        if (channel.isThread()) {
            const auditBefore = threadAuditState(channel);
            const meta = channel.thread_metadata!;
            const perms = req.permission!;
            const isOwner = channel.owner_id === req.user_id;
            const manage = perms.has("MANAGE_THREADS");
            const unarchiveOnly = Object.keys(payload).every((k) => k === "archived" || k === "locked") && payload.archived === false;

            if (payload.permission_overwrites) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
            if (meta.archived && payload.archived !== false && !manage) throw DiscordApiErrors.CANNOT_EDIT_ARCHIVED_THREAD;
            if (meta.archived && meta.locked && payload.archived === false && !manage) throw DiscordApiErrors.THREAD_IS_LOCKED;
            if (!manage && !isOwner && !(unarchiveOnly && (await ThreadMember.existsBy({ id: channel.id, user_id: req.user_id })))) throw DiscordApiErrors.MISSING_PERMISSIONS;
            const changesRate = payload.rate_limit_per_user !== undefined && (payload.rate_limit_per_user || 0) !== (channel.rate_limit_per_user || 0);
            const changesFlags = payload.flags !== undefined && payload.flags !== channel.flags;
            const changesInvitable = payload.invitable !== undefined && payload.invitable !== (meta.invitable ?? true);
            if (!manage && (changesRate || changesFlags || (changesInvitable && !isOwner))) throw DiscordApiErrors.MISSING_PERMISSIONS;
            if (!manage && payload.locked !== undefined && payload.locked !== !!meta.locked) throw DiscordApiErrors.MISSING_PERMISSIONS;

            const changes: { name?: string; rate_limit_per_user?: number; flags?: number; applied_tags?: string[] } = {};
            if (payload.applied_tags) {
                const parent = await Channel.findOneOrFail({ where: { id: channel.parent_id! }, relations: { available_tags: true } });
                const realTags = new Map((parent.available_tags ?? []).map((tag) => [tag.id, tag]));
                const applied = [...new Set(payload.applied_tags)];
                if (applied.length > 5)
                    throw new FieldError(50035, "Invalid Form Body", { applied_tags: makeObjectErrorContent("BASE_TYPE_MAX_LENGTH", "Must be 5 or fewer in length.") });
                if (applied.find((tag) => !realTags.has(tag)))
                    throw new FieldError(50035, "Invalid Form Body", { applied_tags: makeObjectErrorContent("INVALID_TAG", "Invalid tag") });
                const changed = new Set(channel.applied_tags || []).symmetricDifference(new Set(applied));
                if ([...changed].some((tag) => realTags.get(tag)?.moderated)) perms.hasThrow("MANAGE_THREADS");
                changes.applied_tags = applied;
            }
            const renamed = payload.name !== undefined && payload.name !== channel.name;
            if (payload.name !== undefined) changes.name = payload.name.trim();
            if (payload.rate_limit_per_user !== undefined) changes.rate_limit_per_user = payload.rate_limit_per_user;
            if (payload.flags !== undefined) {
                const pinned = Number(ChannelFlags.FLAGS.PINNED);
                changes.flags = (channel.flags & ~pinned) | (payload.flags & pinned);
                if (changes.flags & pinned && !(channel.flags & pinned)) {
                    const others = await Channel.find({ where: { parent_id: channel.parent_id!, id: Not(channel.id) } });
                    for (const other of others.filter((o) => o.flags & pinned)) {
                        other.flags &= ~pinned;
                        await Channel.update({ id: other.id }, { flags: other.flags });
                        await emitThreadUpdate(other);
                    }
                }
            }
            Object.assign(channel, changes);

            const newMeta = { ...meta };
            if (payload.locked !== undefined) newMeta.locked = payload.locked;
            if (payload.invitable !== undefined && channel.isPrivateThread()) newMeta.invitable = payload.invitable;
            if (payload.auto_archive_duration !== undefined) {
                newMeta.auto_archive_duration = payload.auto_archive_duration;
                newMeta.archive_timestamp = new Date().toISOString();
            }
            channel.thread_metadata = newMeta;
            await Channel.update({ id: channel.id }, { ...changes, thread_metadata: newMeta });
            if (payload.archived !== undefined && payload.archived !== meta.archived) await setThreadArchived(channel, payload.archived);

            const threadChanges = AuditLog.diff(auditBefore, threadAuditState(channel), AuditLog.threadKeys);
            if (threadChanges.length && channel.guild_id)
                await AuditLog.log({
                    guild_id: channel.guild_id,
                    user_id: req.user_id,
                    action_type: AuditLogEvents.THREAD_UPDATE,
                    target_id: channel.id,
                    changes: threadChanges,
                    reason: req.headers["x-audit-log-reason"],
                });
            await emitThreadUpdate(channel);
            if (renamed)
                await sendMessage({
                    channel_id: channel.id,
                    type: MessageType.CHANNEL_NAME_CHANGE,
                    content: channel.name,
                    author_id: req.user_id,
                });

            return res.send(channel.toJSON());
        }

        req.permission!.hasThrow("MANAGE_CHANNELS");
        for (const key of THREAD_FIELDS) delete payload[key];
        delete payload.applied_tags;

        if (payload.available_tags) {
            if (!channel.isForum()) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
            if (payload.available_tags.length > 20)
                throw new FieldError(50035, "Invalid Form Body", { available_tags: makeObjectErrorContent("BASE_TYPE_MAX_LENGTH", "Must be 20 or fewer in length.") });
            const existing = new Map((channel.available_tags ?? []).map((tag) => [tag.id, tag]));
            const keep = new Set<string>();
            const tags: Tag[] = [];
            for (const [position, input] of payload.available_tags.entries()) {
                const tag = (input.id && existing.get(input.id)) || Tag.create({ channel_id: channel.id });
                tag.position = position;
                tag.name = input.name.slice(0, 20);
                tag.moderated = !!input.moderated;
                tag.emoji_id = input.emoji_id ?? undefined;
                tag.emoji_name = input.emoji_id ? undefined : (input.emoji_name ?? undefined);
                await tag.save();
                keep.add(tag.id);
                tags.push(tag);
            }
            await Promise.all([...existing.values()].filter((tag) => !keep.has(tag.id)).map((tag) => Tag.delete({ id: tag.id })));
            channel.available_tags = tags;
            delete payload.available_tags;
        }

        if (payload.icon) payload.icon = await handleFile(`/channel-icons/${channel_id}`, payload.icon);
        if (payload.type !== undefined && payload.type !== channel.type) {
            const convertible = [ChannelType.GUILD_TEXT, ChannelType.GUILD_NEWS];
            if (!convertible.includes(channel.type) || !convertible.includes(payload.type)) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
            if (
                payload.type === ChannelType.GUILD_NEWS &&
                !(await Guild.findOneOrFail({ where: { id: channel.guild_id! }, select: { id: true, features: true } })).features.includes("NEWS")
            )
                throw FieldErrors({ type: { code: "BASE_TYPE_CHOICES", message: `Value must be one of {${ChannelType.GUILD_TEXT}}.` } });
        }
        if (payload.default_reaction_emoji)
            payload.default_reaction_emoji = {
                emoji_id: payload.default_reaction_emoji.emoji_id ?? null,
                emoji_name: payload.default_reaction_emoji.emoji_id ? null : (payload.default_reaction_emoji.emoji_name ?? null),
            };

        if (![ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE].includes(channel.type)) {
            delete payload.bitrate;
            delete payload.user_limit;
            delete payload.rtc_region;
            delete payload.video_quality_mode;
        }
        if (payload.topic === "") payload.topic = null;
        const columns = new Set(Channel.getRepository().metadata.columns.map((c) => c.propertyName));
        const update = Object.fromEntries(Object.entries(payload).filter(([key, value]) => columns.has(key) && key !== "id" && value !== undefined));
        const before = { name: channel.name ?? null, icon: channel.icon ?? null };
        const auditBefore = Object.fromEntries(AuditLog.channelKeys.map((key) => [key, (channel as unknown as Record<string, unknown>)[key]]));
        Object.assign(channel, update);
        if (Object.keys(update).length) await Channel.update({ id: channel.id }, update);

        if (channel.guild_id) channel.position = await Channel.calculatePosition(channel.id, channel.guild_id);
        if (channel.type === ChannelType.GROUP_DM) {
            channel.recipients = await Recipient.find({ where: { channel_id } });
            await Channel.emitPrivateChannelUpdate(channel);
            if ((channel.name ?? null) !== before.name) await Channel.sendSystemMessage(channel, req.user_id, MessageType.CHANNEL_NAME_CHANGE, { content: channel.name ?? "" });
            if ((channel.icon ?? null) !== before.icon) await Channel.sendSystemMessage(channel, req.user_id, MessageType.CHANNEL_ICON_CHANGE);
            return res.send(await DmChannelDTO.from(channel, [req.user_id]));
        }

        const changes = AuditLog.diff(auditBefore, channel, AuditLog.channelKeys).filter((change) => change.key !== "permission_overwrites");
        if (changes.length && channel.guild_id)
            await AuditLog.log({
                guild_id: channel.guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.CHANNEL_UPDATE,
                target_id: channel_id,
                changes,
                reason: req.headers["x-audit-log-reason"],
            });

        await emitEvent({
            event: "CHANNEL_UPDATE",
            data: channel.toJSON(),
            channel_id,
        } satisfies ChannelUpdateEvent);

        res.send(channel.toJSON());
    },
);

export default router;
