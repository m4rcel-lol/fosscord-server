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
import { AdminCustomGameUpdateSchema } from "@spacebar/schemas";
import { cleanGameAliases, DetectableGames, serializeCustomGame } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const findGame = (req: Request) => CustomGame.findOneOrFail({ where: { id: req.params.game_id as string } });

// a data: URI uploads new art, null removes it, leaving it out keeps it
const resolveArt = async (gameId: string, data: string | null | undefined, field: string) => {
    if (data === undefined) return undefined;
    if (data === null) return null;
    const hash = await handleFile(`/app-icons/${gameId}`, data);
    if (!hash) throw new HTTPError(`${field} must be a data: URI image`, 400);
    return hash;
};

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminCustomGameUpdateSchema", description: "Change a custom game's name, aliases or art" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminCustomGameUpdateSchema;
        const game = await findGame(req);
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("A game needs a name", 400);
            game.name = body.name.trim();
        }
        if (body.aliases !== undefined) game.aliases = cleanGameAliases(body.aliases);
        const icon = await resolveArt(game.id, body.icon_data, "icon_data");
        if (icon !== undefined) game.icon_hash = icon;
        const cover = await resolveArt(game.id, body.cover_data, "cover_data");
        if (cover !== undefined) game.cover_image_hash = cover;
        await game.save();
        DetectableGames.invalidateCustom();
        res.json(serializeCustomGame(game));
    },
);

router.delete(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Remove a custom game; profiles and servers that list it stop showing it", responses: { 204: {} } }),
    async (req: Request, res: Response) => {
        const game = await findGame(req);
        await CustomGame.delete({ id: game.id });
        DetectableGames.invalidateCustom();
        res.sendStatus(204);
    },
);

export default router;
