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
import { route } from "@spacebar/api/middlewares";
import { ApplicationAuthorization } from "@spacebar/database";
import { ApiError } from "@spacebar/util";
import { toPublicApplication } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const authorizations = await ApplicationAuthorization.find({ where: { user_id: req.user_id }, relations: { application: { bot: true } }, order: { created_at: "DESC" } });
    res.json(authorizations.map((a) => ({ id: a.id, scopes: a.scopes, application: toPublicApplication(a.application) })));
});

router.delete("/:token_id", route({}), async (req: Request, res: Response) => {
    const authorization = await ApplicationAuthorization.findOne({ where: { id: req.params.token_id as string, user_id: req.user_id } });
    if (!authorization) throw new ApiError("Unknown token", 10012, 404);
    await ApplicationAuthorization.delete({ id: authorization.id });
    res.sendStatus(204);
});

export default router;
