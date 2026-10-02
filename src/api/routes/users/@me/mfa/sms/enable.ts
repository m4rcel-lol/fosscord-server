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
import { ResponseError, emitUserUpdate, requireMfa, setSmsFlag } from "@spacebar/api/util";
import { User } from "@spacebar/database";

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
        const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, mfa_enabled: true, totp_secret: true, phone: true } });
        if (!user.mfa_enabled || !user.totp_secret) throw new ResponseError(400, { message: "Two factor is not enabled.", code: 60002 });
        if (!user.phone) throw new ResponseError(400, { message: "You need to verify your phone number before you can enable SMS authentication.", code: 70006 });

        await requireMfa(req, { password: (req.body as { password?: string })?.password });

        if (await setSmsFlag(req.user_id, true)) await emitUserUpdate(req.user_id);
        res.sendStatus(204);
    },
);

export default router;
