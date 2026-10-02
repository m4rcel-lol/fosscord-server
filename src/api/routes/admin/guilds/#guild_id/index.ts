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

import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Channel, Guild, Member, User } from "@spacebar/database";
import { Config, emitEvent, GuildDeleteEvent, GuildUpdateEvent } from "@spacebar/util";
import { AdminGuildUpdateSchema, GuildCreateResponse } from "@spacebar/schemas";
import { pickOwner } from "../index";

const router = Router({ mergeParams: true });

const describeGuild = async (guild_id: string) => {
    const guild = await Guild.findOneOrFail({
        where: { id: guild_id },
        select: { id: true, name: true, icon: true, banner: true, description: true, owner_id: true, features: true, verification_level: true, nsfw: true, premium_tier: true },
    });
    const [memberCount, channelCount, owner] = await Promise.all([
        Member.count({ where: { guild_id } }),
        Channel.count({ where: { guild_id } }),
        guild.owner_id ? User.findOne({ where: { id: guild.owner_id }, select: { id: true, username: true, discriminator: true, global_name: true, avatar: true } }) : null,
    ]);
    return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon ?? null,
        banner: guild.banner ?? null,
        description: guild.description ?? null,
        features: guild.features,
        verification_level: guild.verification_level ?? 0,
        nsfw: guild.nsfw,
        premium_tier: guild.premium_tier ?? 0,
        member_count: memberCount,
        channel_count: channelCount,
        owner: guild.owner_id ? pickOwner(owner, guild.owner_id) : null,
    };
};

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Get a server with its owner and member/channel counts",
    }),
    async (req: Request, res: Response) => {
        res.json(await describeGuild(req.params.guild_id as string));
    },
);

router.patch(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "AdminGuildUpdateSchema",
        description: "Edit a server's name, description, feature flags or owner",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminGuildUpdateSchema;
        const guild_id = req.params.guild_id as string;
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

        if (body.owner_id !== undefined && body.owner_id !== guild.owner_id) {
            if (!(await Member.findOne({ where: { id: body.owner_id, guild_id }, select: { id: true } }))) throw new HTTPError("The new owner must be a member of the server", 400);
            guild.owner_id = body.owner_id;
        }
        if (body.name !== undefined) guild.name = body.name.trim();
        if (body.description !== undefined) guild.description = body.description?.trim() || undefined;
        if (body.features !== undefined) guild.features = [...new Set(body.features.map((f) => f.trim().toUpperCase()).filter(Boolean))];

        await guild.save();

        const data = guild.toJSON();
        delete data.template_id;
        await emitEvent({
            event: "GUILD_UPDATE",
            data: {
                ...data,
                afk_channel_id: data.afk_channel_id ?? undefined,
                public_updates_channel_id: data.public_updates_channel_id ?? undefined,
                rules_channel_id: data.rules_channel_id ?? undefined,
                system_channel_id: data.system_channel_id ?? undefined,
            } satisfies GuildCreateResponse,
            guild_id,
        } satisfies GuildUpdateEvent);

        res.json(await describeGuild(guild_id));
    },
);

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Delete a server regardless of ownership",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true } });

        await Promise.all([
            Guild.delete({ id: guild_id }), // cascades to all guild related data
            emitEvent({ event: "GUILD_DELETE", data: { id: guild_id }, guild_id } satisfies GuildDeleteEvent),
        ]);

        // new users would otherwise be auto-joined into a server that no longer exists
        const autoJoin = Config.get().guild.autoJoin;
        if (autoJoin.guilds?.includes(guild_id)) {
            // assigned rather than merged: Config.set merges arrays index by index, so it can't shrink one
            autoJoin.guilds = autoJoin.guilds.filter((id) => id !== guild_id);
            await Config.set({ guild: { autoJoin } } as Parameters<typeof Config.set>[0]);
        }

        console.log(`[Admin] User ${req.user_id} deleted guild ${guild_id}`);
        res.sendStatus(204);
    },
);

export default router;
