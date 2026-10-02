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
import { User } from "@spacebar/database";
import { broadcastUserUpdate, emitEvent, FieldErrors, UserUpdateEvent } from "@spacebar/util";
import { PrivateUserProjection } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "");
    if (!User.isValidPomeloUsername(username))
        throw FieldErrors({ username: { code: "USERNAME_INVALID_CHARACTERS", message: "Usernames can only contain letters, numbers, underscores and periods." } });
    if (await User.isUsernameTaken(username, req.user_id))
        throw FieldErrors({ username: { code: "USERNAME_ALREADY_TAKEN", message: "Username is unavailable. Try adding numbers, letters, underscores _ , or periods." } });

    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: Object.fromEntries(PrivateUserProjection.map((x) => [x, true])) });
    if (!user.global_name && user.discriminator !== "0") user.global_name = user.username;
    user.username = username;
    user.discriminator = "0";
    await user.save();

    await emitEvent({ event: "USER_UPDATE", user_id: req.user_id, data: user } satisfies UserUpdateEvent);
    await broadcastUserUpdate(req.user_id);
    res.json(user.toPrivateUser());
});

export default router;
