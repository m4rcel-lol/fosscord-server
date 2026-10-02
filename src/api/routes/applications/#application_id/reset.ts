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
import { verifyToken } from "node-2fa";
import { route } from "@spacebar/api/middlewares";
import { hashClientSecret, randomOAuth2Token } from "@spacebar/api/util";
import { Application, User } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        description: "Reset the application's OAuth2 client secret",
        responses: {
            200: {},
            400: { body: "APIErrorResponse" },
            403: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const app = await Application.findOneOrFail({ where: { id: req.params.application_id as string }, select: { id: true, owner_id: true } });
        if (app.owner_id !== req.user_id) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
        const owner = await User.findOneOrFail({ where: { id: app.owner_id }, select: { id: true, totp_secret: true } });
        if (owner.totp_secret && (!req.body?.code || !verifyToken(owner.totp_secret, req.body.code))) throw new HTTPError(req.t("auth:login.INVALID_TOTP_CODE"), 60008);
        const secret = randomOAuth2Token();
        await Application.update({ id: app.id }, { client_secret_hash: hashClientSecret(secret) });
        res.json({ secret });
    },
);

export default router;
