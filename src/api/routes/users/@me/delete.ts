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
import { route } from "@spacebar/api/middlewares";
import { ResponseError, requireAccountPassword, revokeSessions } from "@spacebar/api/util";
import { Guild, User } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        await requireAccountPassword(req);

        if (await Guild.exists({ where: { owner_id: req.user_id } }))
            throw new ResponseError(400, { message: "You must transfer ownership of any owned servers before deleting your account.", code: 40011 });

        await User.update({ id: req.user_id }, { deleted: true });
        res.sendStatus(204);
        await revokeSessions(req.user_id);
    },
);

export default router;
