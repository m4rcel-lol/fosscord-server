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
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { PublicMemberProjection, PublicUserProjection } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        oauth2: ["guilds.members.read"],
        description: "Get the current user's member object in a guild",
        responses: {
            200: { body: "PublicMember" },
            404: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const member = await Member.findOne({
            where: { id: req.user_id, guild_id },
            relations: { roles: true, user: true },
            select: {
                index: true,
                ...Object.fromEntries(PublicMemberProjection.map((x) => [x, true])),
                user: Object.fromEntries(PublicUserProjection.map((x) => [x, true])),
                roles: { id: true },
            },
        });
        if (!member) throw DiscordApiErrors.UNKNOWN_GUILD;
        res.json({
            ...member.toPublicMember(),
            user: member.user.toPublicUser(),
            roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
        });
    },
);

export default router;
