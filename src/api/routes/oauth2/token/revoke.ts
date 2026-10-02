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

import { Request, Response, Router, urlencoded } from "express";
import { route } from "@spacebar/api/middlewares";
import { authenticateClient, isPublicClient, OAuth2Error, revokeOAuth2Grant } from "@spacebar/api/util";
import { OAuth2Token } from "@spacebar/database";
import { hashOAuth2Token } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    urlencoded({ extended: false }),
    route({
        authentication: "never",
        description: "Revoke an OAuth2 access or refresh token, invalidating every token the application holds for that user",
        responses: { 200: {}, 400: {}, 401: {} },
    }),
    async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const app = await authenticateClient(req, isPublicClient);
        if (typeof body.token !== "string" || !body.token) throw OAuth2Error("invalid_request", 'Missing "token" in request.');
        const hash = hashOAuth2Token(body.token);
        const row = await OAuth2Token.findOne({
            where: [
                { access_token_hash: hash, application_id: app.id },
                { refresh_token_hash: hash, application_id: app.id },
            ],
            select: { id: true, user_id: true, application_id: true },
        });
        if (row) await revokeOAuth2Grant(row.user_id, row.application_id);
        res.json({});
    },
);

export default router;
