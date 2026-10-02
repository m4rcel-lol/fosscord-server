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

import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { DetectableGames } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });
// modern dclients call this, is /applications/detectable deprecated?
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "ApplicationDetectableResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const cache = await DetectableGames.load();

        res.set("Cache-Control", `public, max-age=${Math.floor((cache.expires - Date.now()) / 1000)}, s-maxage=${Math.floor((cache.expires - Date.now()) / 1000)}, immutable`)
            .status(200)
            .json(cache.games);
    },
);

export default router;
