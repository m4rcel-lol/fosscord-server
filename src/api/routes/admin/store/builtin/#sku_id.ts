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
import { StoreHiddenPack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStoreBuiltinPackUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStoreBuiltinPackUpdateSchema",
        description: "Take a mirrored discord pack out of the shop or put it back; people who have its items keep them",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStoreBuiltinPackUpdateSchema;
        const sku_id = req.params.sku_id as string;
        if (!(await Collectibles.builtinCategories()).some((category) => category.sku_id === sku_id)) throw new HTTPError("Unknown pack", 404);
        if (body.hidden) await StoreHiddenPack.upsert({ sku_id }, ["sku_id"]);
        else await StoreHiddenPack.delete({ sku_id });
        Collectibles.reload();
        res.json({ sku_id, hidden: body.hidden });
    },
);

export default router;
