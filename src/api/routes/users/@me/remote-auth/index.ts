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
import { ResponseError, signTicket } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { EVENT, Event, emitEvent } from "@spacebar/util";

export const emitRemoteAuth = (fingerprint: string, event: string, data: Record<string, unknown> = {}) =>
    emitEvent({ session_id: `remote-auth:${fingerprint}`, event: event as EVENT, data } as Event);

const router = Router({ mergeParams: true });

router.post("/", route({ spacebarOnly: false }), async (req: Request, res: Response) => {
    const { fingerprint } = req.body as { fingerprint?: string };
    if (typeof fingerprint !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) throw new ResponseError(400, { message: "Invalid remote auth fingerprint", code: 10061 });

    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, username: true, discriminator: true, avatar: true } });
    await emitRemoteAuth(fingerprint, "REMOTE_AUTH_PENDING_TICKET", { user: `${user.id}:${user.discriminator}:${user.avatar ?? "0"}:${user.username}` });

    res.json({ handshake_token: signTicket({ typ: "ra_handshake", uid: user.id, fp: fingerprint }, 300) });
});

export default router;
