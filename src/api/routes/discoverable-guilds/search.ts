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
import { Brackets } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Guild } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "DiscoverableGuildsSearchResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const term = String(req.query.query ?? "")
            .trim()
            .slice(0, 100);
        const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 2999);
        const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 48);
        const categoryId = req.query.category_id ? Number(req.query.category_id) : Number.NaN;

        const base = () => {
            const qb = Guild.createQueryBuilder("guild").where("guild.discovery_excluded = false").andWhere(":feature = ANY(guild.features)", { feature: "DISCOVERABLE" });
            if (!term) return qb;
            return qb.andWhere(
                new Brackets((b) => b.where("guild.name ILIKE :pattern").orWhere("guild.description ILIKE :pattern").orWhere("guild.vanity_url_code ILIKE :pattern")),
                { pattern: `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` },
            );
        };

        const filtered = base();
        if (!Number.isNaN(categoryId)) filtered.andWhere("guild.primary_category_id = :categoryId", { categoryId });
        const [guilds, total] = await filtered.orderBy("guild.discovery_weight", "DESC").addOrderBy("guild.member_count", "DESC").skip(offset).take(limit).getManyAndCount();

        const categories =
            req.query.with_counts === "true"
                ? (
                      await base()
                          .select("guild.primary_category_id", "id")
                          .addSelect("COUNT(*)::int", "count")
                          .andWhere("guild.primary_category_id IS NOT NULL")
                          .groupBy("guild.primary_category_id")
                          .orderBy("count", "DESC")
                          .getRawMany<{ id: number; count: number }>()
                  ).map(({ id, count }) => ({ id: Number(id), count }))
                : undefined;

        res.send({
            guilds: (await Promise.all(guilds.map((g) => g.toDiscoverableGuild()))).filter((g) => g !== null),
            total_count: total,
            offset,
            limit,
            categories,
        });
    },
);

export default router;
