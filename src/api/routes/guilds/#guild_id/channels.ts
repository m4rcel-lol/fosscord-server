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
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Channel, Guild } from "@spacebar/database";
import { ChannelUpdateEvent, Config, DiscordApiErrors, emitEvent, FieldErrors } from "@spacebar/util";
import { THREAD_TYPES } from "@spacebar/api/util";
import { AuditLogEvents, ChannelCreateSchema, ChannelReorderSchema, ChannelType } from "@spacebar/schemas";
import { In, Not } from "typeorm";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            201: {
                body: "APIChannelArray",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const [channels, guild] = await Promise.all([
            Channel.find({
                where: { guild_id, type: Not(In([ChannelType.GUILD_NEWS_THREAD, ChannelType.GUILD_PUBLIC_THREAD, ChannelType.GUILD_PRIVATE_THREAD])) },
                relations: { available_tags: true },
            }),
            Guild.findOneOrFail({ where: { id: guild_id }, select: { channel_ordering: true, id: true } }),
        ]);

        for (const channel of channels) channel.position = guild.channel_ordering.indexOf(channel.id);
        channels.sort((a, b) => a.position - b.position);

        res.json(channels);
    },
);

router.post(
    "/",
    route({
        requestBody: "ChannelCreateSchema",
        permission: "MANAGE_CHANNELS",
        responses: {
            201: {
                body: "Channel",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        // creates a new guild channel https://discord.com/developers/docs/resources/guild#create-guild-channel
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as ChannelCreateSchema;
        const { maxName } = Config.get().limits.channel;
        if (body.name !== undefined && (body.name.length < 1 || body.name.length > maxName))
            throw FieldErrors({ name: { code: "BASE_TYPE_BAD_LENGTH", message: `Must be between 1 and ${maxName} in length.` } });

        if (body.type === ChannelType.GUILD_NEWS || body.type === ChannelType.GUILD_STAGE_VOICE) {
            const { features } = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, features: true } });
            const allowed = body.type === ChannelType.GUILD_NEWS ? features.includes("NEWS") : features.includes("COMMUNITY");
            if (!allowed) {
                const types = [ChannelType.GUILD_TEXT, ChannelType.GUILD_VOICE, ChannelType.GUILD_CATEGORY];
                if (features.includes("NEWS")) types.push(ChannelType.GUILD_NEWS);
                if (features.includes("COMMUNITY")) types.push(ChannelType.GUILD_STAGE_VOICE);
                types.push(ChannelType.GUILD_FORUM, ChannelType.GUILD_MEDIA);
                throw FieldErrors({ type: { code: "BASE_TYPE_CHOICES", message: `Value must be one of {${types.join(", ")}}.` } });
            }
        }

        const channel = await Channel.createChannel({ ...body, type: body.type ?? ChannelType.GUILD_TEXT, guild_id }, req.user_id);
        channel.position = await Channel.calculatePosition(channel.id, guild_id, channel.guild);
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.CHANNEL_CREATE,
            target_id: channel.id,
            changes: AuditLog.diff({}, channel, AuditLog.channelKeys),
            reason: req.headers["x-audit-log-reason"],
        });

        res.status(201).json(channel);
    },
);

router.patch(
    "/",
    route({
        requestBody: "ChannelReorderSchema",
        permission: "MANAGE_CHANNELS",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as ChannelReorderSchema;

        const [guild, channels] = await Promise.all([
            Guild.findOneOrFail({ where: { id: guild_id }, select: { channel_ordering: true, id: true } }),
            Channel.find({ where: { guild_id, type: Not(In(THREAD_TYPES)) } }),
        ]);
        const byId = new Map(channels.map((c) => [c.id, c]));
        const ordering = guild.channel_ordering.filter((id) => byId.has(id));
        for (const c of channels) if (!ordering.includes(c.id)) ordering.push(c.id);
        const index = new Map(ordering.map((id, i) => [id, i]));

        const changedParent = new Set<string>();
        const wanted = new Map<string, number>();
        for (const opt of body) {
            const channel = byId.get(opt.id);
            if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
            if (opt.position !== undefined && opt.position !== null) wanted.set(opt.id, Number(opt.position));
            if (opt.parent_id !== undefined && (opt.parent_id ?? null) !== (channel.parent_id ?? null)) {
                const parent = opt.parent_id ? byId.get(opt.parent_id) : null;
                if (opt.parent_id && parent?.type !== ChannelType.GUILD_CATEGORY) throw DiscordApiErrors.UNKNOWN_CHANNEL;
                if (channel.type === ChannelType.GUILD_CATEGORY && parent) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
                channel.parent_id = parent?.id ?? null;
                if (opt.lock_permissions && parent) channel.permission_overwrites = parent.permission_overwrites;
                changedParent.add(channel.id);
                await Channel.update(
                    { id: channel.id },
                    { parent_id: channel.parent_id, ...(opt.lock_permissions && parent ? { permission_overwrites: parent.permission_overwrites } : {}) },
                );
            }
        }

        const newOrdering = [...ordering].sort((a, b) => {
            const pa = wanted.get(a) ?? index.get(a)!;
            const pb = wanted.get(b) ?? index.get(b)!;
            if (pa !== pb) return pa - pb;
            const wa = wanted.has(a) ? 0 : 1;
            const wb = wanted.has(b) ? 0 : 1;
            return wa !== wb ? wa - wb : index.get(a)! - index.get(b)!;
        });
        await Guild.update({ id: guild_id }, { channel_ordering: newOrdering });

        await Promise.all(
            newOrdering.map(async (id, position) => {
                if (index.get(id) === position && !changedParent.has(id)) return;
                const channel = byId.get(id)!;
                channel.position = position;
                await emitEvent({
                    event: "CHANNEL_UPDATE",
                    data: channel.toJSON(),
                    channel_id: channel.id,
                    guild_id,
                } satisfies ChannelUpdateEvent);
            }),
        );

        return res.sendStatus(204);
    },
);

export default router;
