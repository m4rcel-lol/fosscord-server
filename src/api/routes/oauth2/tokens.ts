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

import { Router, Request, Response } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { ApplicationAuthorization, OAuth2Token } from "@spacebar/database";
import { ApiError, emitEvent, OAuth2TokenDeleteEvent } from "@spacebar/util";
import { toPublicApplication } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

const serialize = (authorization: ApplicationAuthorization) => ({
    id: authorization.id,
    scopes: authorization.scopes,
    application: toPublicApplication(authorization.application),
});

router.get(
    "/",
    route({
        query: { application_ids: { type: "array", description: "The applications to return authorizations for (max 50)" } },
        responses: { 200: {} },
    }),
    async (req: Request, res: Response) => {
        const ids = [req.query.application_ids ?? []]
            .flat()
            .flatMap((id) => String(id).split(","))
            .filter((id) => /^\d{1,20}$/.test(id));
        const authorizations = await ApplicationAuthorization.find({
            where: { user_id: req.user_id, ...(ids.length && { application_id: In(ids.slice(0, 50)) }) },
            relations: { application: { bot: true } },
            order: { created_at: "DESC" },
        });
        res.json(authorizations.map(serialize));
    },
);

router.get("/:token_id", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const authorization = await ApplicationAuthorization.findOne({ where: { id: req.params.token_id as string, user_id: req.user_id }, relations: { application: { bot: true } } });
    if (!authorization) throw new ApiError("Unknown token", 10012, 404);
    res.json(serialize(authorization));
});

router.delete("/:token_id", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const authorization = await ApplicationAuthorization.findOne({ where: { id: req.params.token_id as string, user_id: req.user_id } });
    if (!authorization) throw new ApiError("Unknown token", 10012, 404);
    await OAuth2Token.delete({ user_id: req.user_id, application_id: authorization.application_id });
    await ApplicationAuthorization.delete({ id: authorization.id });
    await emitEvent({
        event: "OAUTH2_TOKEN_DELETE",
        user_id: req.user_id,
        data: { id: authorization.id, application_id: authorization.application_id },
    } satisfies OAuth2TokenDeleteEvent);
    res.sendStatus(204);
});

export default router;
