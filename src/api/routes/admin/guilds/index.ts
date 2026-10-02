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
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member, User } from "@spacebar/database";

const router = Router({ mergeParams: true });

export const pickOwner = (user: User | null | undefined, id: string) =>
    user ? { id: user.id, username: user.username, discriminator: user.discriminator, global_name: user.global_name ?? null, avatar: user.avatar ?? null } : { id };

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Search servers on this instance. `q` matches an exact id or part of the name.",
        query: {
            q: { type: "string", required: false },
            limit: { type: "number", required: false },
            offset: { type: "number", required: false },
        },
    }),
    async (req: Request, res: Response) => {
        const q = String(req.query.q ?? "").trim();
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const query = Guild.createQueryBuilder("guild")
            .select(["guild.id", "guild.name", "guild.icon", "guild.owner_id", "guild.features", "guild.description", "guild.profile"])
            .addSelect((sub) => sub.select("COUNT(*)", "count").from(Member, "member").where("member.guild_id = guild.id"), "member_count")
            .orderBy("guild.id", "DESC")
            .limit(limit)
            .offset(offset);

        if (/^\d{15,20}$/.test(q)) query.where("guild.id = :id", { id: q });
        else if (q) query.where("guild.name ILIKE :q", { q: `%${q}%` });

        const [{ entities, raw }, total] = await Promise.all([query.getRawAndEntities(), query.getCount()]);

        const ownerIds = [...new Set(entities.map((g) => g.owner_id).filter((id): id is string => !!id))];
        const owners = ownerIds.length ? await User.find({ where: { id: In(ownerIds) }, select: { id: true, username: true, discriminator: true, global_name: true } }) : [];

        res.json({
            total,
            guilds: entities.map((g, i) => ({
                id: g.id,
                name: g.name,
                icon: g.icon ?? null,
                description: g.description ?? null,
                features: g.features,
                member_count: Number(raw[i]?.member_count ?? 0),
                tag: g.profile?.tag ? { tag: g.profile.tag, badge_hash: g.profile.badge_hash ?? null } : null,
                owner: g.owner_id
                    ? pickOwner(
                          owners.find((o) => o.id === g.owner_id),
                          g.owner_id,
                      )
                    : null,
            })),
        });
    },
);

export default router;
