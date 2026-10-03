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
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { emitEvent, handleFile, UserUpdateEvent } from "@spacebar/util";
import { AdminOfficialAccountUpdateSchema, PrivateUserProjection } from "@spacebar/schemas";
import { getSystemAccount, serializeOfficial } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// nobody can sign in as the official account, so its profile picture is set from here
router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminOfficialAccountUpdateSchema",
        description: "Change the profile picture of the official account announcements come from",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminOfficialAccountUpdateSchema;
        const official = await getSystemAccount("official");

        if (body.avatar !== undefined) {
            const avatar = body.avatar ? await handleFile(`/avatars/${official.id}`, body.avatar) : null;
            if (body.avatar && !avatar) throw new HTTPError("avatar must be a data: URI image", 400);
            // null puts the default picture back
            await User.update({ id: official.id }, { avatar: avatar as string });
        }

        const updated = await User.findOneOrFail({ where: { id: official.id }, select: Object.fromEntries(PrivateUserProjection.map((key) => [key, true])) });
        await emitEvent({ event: "USER_UPDATE", user_id: official.id, data: updated } satisfies UserUpdateEvent);
        res.json(serializeOfficial(updated));
    },
);

export default router;
