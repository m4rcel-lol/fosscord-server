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
import { GuildJoinRequestActionSchema } from "@spacebar/schemas";
import { actionJoinRequest, findJoinRequest, UNKNOWN_JOIN_REQUEST } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.patch("/", route({ permission: "KICK_MEMBERS", requestBody: "GuildJoinRequestActionSchema" }), async (req: Request, res: Response) => {
    const { guild_id, request_id } = req.params as { [key: string]: string };
    const { action, rejection_reason } = req.body as GuildJoinRequestActionSchema;
    const request = await findJoinRequest({ guild_id, id: request_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    res.json((await actionJoinRequest(request, req.user_id, action, rejection_reason)).toJSON("moderator"));
});

export default router;
