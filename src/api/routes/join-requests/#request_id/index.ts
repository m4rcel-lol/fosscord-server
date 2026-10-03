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
import { findJoinRequest, openInterview, requireJoinRequestModerator, UNKNOWN_JOIN_REQUEST } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { request_id } = req.params as { [key: string]: string };
    const request = await findJoinRequest({ id: request_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    if (request.user_id === req.user_id) return res.json(request.toJSON("self"));
    await requireJoinRequestModerator(request.guild_id, req.user_id).catch(() => {
        throw UNKNOWN_JOIN_REQUEST;
    });
    res.json(request.toJSON("moderator"));
});

router.post("/interview", route({}), async (req: Request, res: Response) => {
    const { request_id } = req.params as { [key: string]: string };
    const request = await findJoinRequest({ id: request_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    await requireJoinRequestModerator(request.guild_id, req.user_id);
    res.json(await openInterview(request, req.user_id));
});

export default router;
