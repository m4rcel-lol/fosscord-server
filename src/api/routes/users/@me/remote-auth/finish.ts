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
import { ResponseError, readTicket } from "@spacebar/api/util";
import { emitRemoteAuth } from "./index";

export const readHandshake = (req: Request) => {
    const decoded = readTicket<{ typ: string; uid?: string; fp?: string }>(req.body?.handshake_token, "ra_handshake");
    if (!decoded?.fp || decoded.uid !== req.user_id) throw new ResponseError(400, { message: "Invalid remote auth handshake token", code: 10061 });
    return decoded.fp;
};

const router = Router({ mergeParams: true });

router.post("/", route({ spacebarOnly: false }), async (req: Request, res: Response) => {
    await emitRemoteAuth(readHandshake(req), "REMOTE_AUTH_PENDING_LOGIN", { user_id: req.user_id });
    res.sendStatus(204);
});

export default router;
