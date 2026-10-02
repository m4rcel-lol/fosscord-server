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
import { Brackets } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            query: {
                type: "string",
                description: "username, global name or nickname prefix to match",
            },
            limit: {
                type: "number",
                description: "max number of members to return (1-1000). default 1",
            },
        },
        responses: {
            200: {
                body: "PublicMemberListResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const limit = Number(req.query.limit) || 1;
        if (limit > 1000 || limit < 1) throw new HTTPError("Limit must be between 1 and 1000");
        const query = typeof req.query.query === "string" ? req.query.query.toLowerCase() : "";

        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const prefix = `${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const members = await Member.createQueryBuilder("member")
            .leftJoinAndSelect("member.user", "user")
            .leftJoinAndSelect("member.roles", "role")
            .where("member.guild_id = :guild_id", { guild_id })
            .andWhere(
                new Brackets((qb) =>
                    qb
                        .where("LOWER(user.username) LIKE :prefix", { prefix })
                        .orWhere("LOWER(user.global_name) LIKE :prefix", { prefix })
                        .orWhere("LOWER(member.nick) LIKE :prefix", { prefix }),
                ),
            )
            .orderBy("member.joined_at", "ASC")
            .getMany();

        return res.json(
            members.slice(0, limit).map((m) => ({
                ...m.toPublicMember(),
                user: m.user.toPublicUser(),
                roles: m.roles.map((x) => x.id).filter((id) => id !== guild_id),
            })),
        );
    },
);

export default router;
