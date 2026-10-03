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
import { CustomGame } from "@spacebar/database";
import { handleFile } from "@spacebar/util";
import { AdminCustomGameCreateSchema } from "@spacebar/schemas";
import { cleanGameAliases, DetectableGames, serializeCustomGame } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "List the games admins added for users to put on their profiles and servers" }),
    async (req: Request, res: Response) => {
        const games = await CustomGame.find({ order: { name: "ASC" } });
        res.json(games.map(serializeCustomGame));
    },
);

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminCustomGameCreateSchema", description: "Add a custom game users can pick for their profile and server" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminCustomGameCreateSchema;
        const game = CustomGame.create({ name: body.name.trim(), aliases: cleanGameAliases(body.aliases), created_by: req.user_id });
        if (!game.name) throw new HTTPError("A game needs a name", 400);
        // the client loads game art from app-icons/<game id>/<hash>, like discord's own games
        if (body.icon_data && !(game.icon_hash = await handleFile(`/app-icons/${game.id}`, body.icon_data))) throw new HTTPError("icon_data must be a data: URI image", 400);
        if (body.cover_data && !(game.cover_image_hash = await handleFile(`/app-icons/${game.id}`, body.cover_data)))
            throw new HTTPError("cover_data must be a data: URI image", 400);
        await game.save();
        DetectableGames.invalidateCustom();
        res.status(201).json(serializeCustomGame(game));
    },
);

export default router;
