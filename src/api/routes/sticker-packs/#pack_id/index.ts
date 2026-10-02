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

import { route } from "@spacebar/api/middlewares";
import { ensureStandardStickerPacks } from "@spacebar/api/util";
import { StickerPack } from "@spacebar/database";
import { HTTPError } from "lambert-server/HTTPError";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {},
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        await ensureStandardStickerPacks();
        const pack = await StickerPack.findOne({
            where: { id: req.params.pack_id as string },
            relations: { stickers: true },
            order: { stickers: { sort_value: "ASC" } },
        });
        if (!pack) throw new HTTPError("Unknown sticker pack", 404);
        res.json(pack);
    },
);

export default router;
