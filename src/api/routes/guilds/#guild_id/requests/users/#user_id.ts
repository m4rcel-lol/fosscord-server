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
import { Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { GuildJoinRequest } from "@spacebar/database";
import { requireJoinRequestModerator } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id, user_id } = req.params as { [key: string]: string };
    const target = user_id === "@me" ? req.user_id : user_id;
    if (target !== req.user_id) await requireJoinRequestModerator(guild_id, req.user_id);
    const requests = await GuildJoinRequest.find({
        where: { guild_id, user_id: target, application_status: Not("STARTED") },
        relations: { user: true, actioned_by: true },
        order: { id: "DESC" },
    });
    res.json(requests.map((request) => request.toJSON(target === req.user_id ? "self" : "moderator")));
});

export default router;
