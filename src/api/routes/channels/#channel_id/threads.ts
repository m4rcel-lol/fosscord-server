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
import { ArrayContains, ArrayOverlap, FindOptionsWhere, ILike, In, LessThan } from "typeorm";
import { createThread, handleMessage, postHandleMessage, sendMessage, THREAD_TYPES, threadSearchExtras } from "@spacebar/api/util";
import { route } from "@spacebar/api/middlewares";
import { Attachment, Channel, Member, ReadState, ThreadMember } from "@spacebar/database";
import { ChannelFlags, emitEvent, FieldErrors, MessageCreateEvent, uploadFile } from "@spacebar/util";
import { ChannelType, MessageCreateAttachment, MessageCreateCloudAttachment, MessageType, ThreadCreationSchema } from "@spacebar/schemas";
import { messageUpload } from "./messages";

const router = Router({ mergeParams: true });

router.post(
    "/",
    messageUpload.any(),
    (req, res, next) => {
        if (req.body.payload_json) {
            req.body = JSON.parse(req.body.payload_json);
        }

        next();
    },
    route({
        requestBody: "ThreadCreationSchema",
        permission: "VIEW_CHANNEL",
        responses: {
            201: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const body = req.body as ThreadCreationSchema;

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { available_tags: true },
        });

        let type: ChannelType;
        if (channel.threadOnly()) {
            req.permission!.hasThrow("SEND_MESSAGES");
            if (!body.message) throw FieldErrors({ message: { code: "BASE_TYPE_REQUIRED", message: "This field is required" } });
            type = ChannelType.GUILD_PUBLIC_THREAD;
            const tags = new Map((channel.available_tags ?? []).map((tag) => [tag.id, tag]));
            const applied = [...new Set(body.applied_tags ?? [])];
            if (!applied.length && channel.flags & Number(ChannelFlags.FLAGS.REQUIRE_TAG) && !req.permission!.has("MANAGE_THREADS"))
                throw FieldErrors({ applied_tags: { code: "TAG_REQUIRED", message: "A tag is required to create a forum post in this channel" } });
            if (applied.length > 5) throw FieldErrors({ applied_tags: { code: "BASE_TYPE_MAX_LENGTH", message: "Must be 5 or fewer in length." } });
            const bad = applied.find((tag) => !tags.has(tag));
            if (bad) throw FieldErrors({ applied_tags: { code: "INVALID_TAG", message: `Invalid tag ${bad}` } });
            if (applied.some((tag) => tags.get(tag)?.moderated)) req.permission!.hasThrow("MANAGE_THREADS");
            body.applied_tags = applied;
        } else {
            type = body.type ?? ChannelType.GUILD_PRIVATE_THREAD;
            if (type === ChannelType.GUILD_PUBLIC_THREAD && channel.type === ChannelType.GUILD_NEWS) type = ChannelType.GUILD_NEWS_THREAD;
            req.permission!.hasThrow(type === ChannelType.GUILD_PRIVATE_THREAD ? "CREATE_PRIVATE_THREADS" : "CREATE_PUBLIC_THREADS");
            body.applied_tags = undefined;
        }

        const { thread, member } = await createThread({
            parent: channel,
            user_id: req.user_id,
            name: body.name,
            type,
            auto_archive_duration: body.auto_archive_duration,
            rate_limit_per_user: body.rate_limit_per_user,
            invitable: body.invitable,
            applied_tags: body.applied_tags,
        });

        if (!channel.threadOnly() && type !== ChannelType.GUILD_PRIVATE_THREAD)
            await sendMessage({
                channel_id: channel.id,
                type: MessageType.THREAD_CREATED,
                content: thread.name,
                message_reference: {
                    channel_id: thread.id,
                    guild_id: thread.guild_id,
                },
                author_id: req.user_id,
            });

        if (!body.message) return res.status(201).json({ ...thread.toJSON(), member: member.toJSON() });

        const files = (req.files as Express.Multer.File[]) ?? [];
        const attachments: (Attachment | MessageCreateAttachment | MessageCreateCloudAttachment)[] = body.message.attachments ?? [];
        for (const currFile of files) attachments.push(await uploadFile(`/attachments/${thread.id}`, currFile));

        const message = await handleMessage({
            ...body.message,
            allowed_mentions: body.message.allowed_mentions
                ? { ...body.message.allowed_mentions, parse: body.message.allowed_mentions.parse as ("users" | "roles" | "everyone")[] }
                : undefined,
            id: thread.id,
            type: MessageType.DEFAULT,
            pinned: false,
            author_id: req.user_id,
            embeds: body.message.embeds || [],
            channel_id: thread.id,
            attachments,
            timestamp: new Date(),
        } as Parameters<typeof handleMessage>[0]);
        if (message.guild_id && !message.member) {
            message.member = await Member.findOneOrFail({
                where: { id: req.user_id, guild_id: message.guild_id },
                relations: { roles: true },
            });
        }
        if (message.member?.roles)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            message.member.roles = message.member.roles.filter((x) => x.id != x.guild_id).map((x) => x.id);

        const read_state =
            (await ReadState.findOne({ where: { user_id: req.user_id, channel_id: thread.id } })) ?? ReadState.create({ user_id: req.user_id, channel_id: thread.id });
        read_state.last_message_id = message.id;
        read_state.mention_count = 0;

        await Promise.all([
            read_state.save(),
            message.save(),
            emitEvent({
                event: "MESSAGE_CREATE",
                channel_id: thread.id,
                data: message.toJSON(),
            } satisfies MessageCreateEvent),
            Member.update({ id: req.user_id, guild_id: thread.guild_id! }, { last_message_id: message.id }),
        ]);
        postHandleMessage(message).catch((e) => console.error("[Message] post-message handler failed", e));

        return res.status(201).json({ ...thread.toJSON(), member: member.toJSON(), message: message.toJSON() });
    },
);

const joinedThreadIds = async (user_id: string) => new Set((await ThreadMember.find({ where: { user_id }, select: { id: true } })).map((m) => m.id));

router.get(
    "/search",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            200: {},
            403: {
                body: "APIErrorResponse",
            },
            422: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { name, tag, tag_setting, archived, sort_by, sort_order, limit, offset } = req.query as Record<string, string | undefined>;
        const { channel_id } = req.params as Record<string, string>;
        const tags = tag ? tag.split(",").filter(Boolean) : [];
        const take = Math.min(Math.max(Number(limit) || 25, 1), 25);
        const skip = Math.max(Number(offset) || 0, 0);

        if (sort_by && !["last_message_time", "archive_time", "relevance", "creation_time"].includes(sort_by))
            throw FieldErrors({
                sort_by: {
                    message: "Value must be one of ('last_message_time', 'archive_time', 'relevance', 'creation_time').",
                    code: "BASE_TYPE_CHOICES",
                },
            });

        if (!req.permission!.has("READ_MESSAGE_HISTORY"))
            return res.json({ threads: [], members: [], has_more: false, total_results: 0, first_messages: [], most_recent_messages: [] });
        const canManage = req.permission!.has("MANAGE_THREADS");

        const where: FindOptionsWhere<Channel> = {
            parent_id: channel_id,
            type: In(THREAD_TYPES),
            ...(name ? { name: ILike(`%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) } : {}),
            ...(tags.length ? { applied_tags: tag_setting === "match_all" ? ArrayContains(tags) : ArrayOverlap(tags) } : {}),
        };
        const joined = await joinedThreadIds(req.user_id);
        const threads = (await Channel.find({ where })).filter(
            (t) => (archived === undefined || !!t.thread_metadata?.archived === (archived === "true")) && (!t.isPrivateThread() || canManage || joined.has(t.id)),
        );

        const dir = sort_order === "asc" ? 1 : -1;
        const key = (t: Channel) => {
            switch (sort_by) {
                case "creation_time":
                    return BigInt(t.id);
                case "archive_time":
                    return BigInt(new Date(t.thread_metadata?.archive_timestamp ?? 0).getTime());
                default:
                    return BigInt(t.last_message_id ?? t.id);
            }
        };
        threads.sort((a, b) => {
            const ka = key(a);
            const kb = key(b);
            return ka === kb ? 0 : (ka > kb ? 1 : -1) * dir;
        });

        const total_results = threads.length;
        const page = threads.slice(skip, skip + take);
        const extras = await threadSearchExtras(page, req.user_id);

        return res.json({
            threads: page.map((t) => ({ ...t.toJSON(), owner: extras.owners.get(t.owner_id!) ?? null })),
            members: extras.members,
            first_messages: extras.first_messages,
            most_recent_messages: extras.most_recent_messages,
            total_results,
            has_more: skip + page.length < total_results,
        });
    },
);

export const listArchivedThreads = (kind: "public" | "private" | "joined") =>
    async function (req: Request, res: Response) {
        const { channel_id } = req.params as Record<string, string>;
        const { before, limit } = req.query as Record<string, string | undefined>;
        const take = Math.min(Math.max(Number(limit) || 50, 2), 100);
        if (kind === "private") req.permission!.hasThrow("MANAGE_THREADS");
        req.permission!.hasThrow("READ_MESSAGE_HISTORY");

        const joined = await joinedThreadIds(req.user_id);
        const types = kind === "public" ? [ChannelType.GUILD_PUBLIC_THREAD, ChannelType.GUILD_NEWS_THREAD] : [ChannelType.GUILD_PRIVATE_THREAD];
        let threads = (await Channel.find({ where: { parent_id: channel_id, type: In(types), ...(kind === "joined" && before ? { id: LessThan(before) } : {}) } })).filter(
            (t) => !!t.thread_metadata?.archived && (kind !== "joined" || joined.has(t.id)),
        );
        if (kind === "joined") threads.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
        else {
            const beforeTime = before ? new Date(before).getTime() : Infinity;
            threads = threads
                .filter((t) => new Date(t.thread_metadata!.archive_timestamp).getTime() < beforeTime)
                .sort((a, b) => new Date(b.thread_metadata!.archive_timestamp).getTime() - new Date(a.thread_metadata!.archive_timestamp).getTime());
        }
        const page = threads.slice(0, take);
        const members = await ThreadMember.find({ where: { user_id: req.user_id, id: In(page.map((t) => t.id)) } });
        return res.json({ threads: page.map((t) => t.toJSON()), members: members.map((m) => m.toJSON()), has_more: threads.length > take });
    };

router.get("/archived/public", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {} } }), listArchivedThreads("public"));
router.get("/archived/private", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {} } }), listArchivedThreads("private"));

router.get("/active", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const canManage = req.permission!.has("MANAGE_THREADS");
    const joined = await joinedThreadIds(req.user_id);
    const threads = (await Channel.find({ where: { parent_id: channel_id, type: In(THREAD_TYPES) } })).filter(
        (t) => !t.thread_metadata?.archived && (!t.isPrivateThread() || canManage || joined.has(t.id)),
    );
    const members = await ThreadMember.find({ where: { user_id: req.user_id, id: In(threads.map((t) => t.id)) } });
    return res.json({ threads: threads.map((t) => t.toJSON()), members: members.map((m) => m.toJSON()), has_more: false });
});

export default router;
