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
import { StorePack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStorePackCreateSchema } from "@spacebar/schemas";
import { serializeStorePack, uploadStoreArt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminStorePackCreateSchema", description: "Add a pack to the store" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStorePackCreateSchema;
        const pack = StorePack.create({ name: body.name.trim(), summary: body.summary?.trim() ?? "", position: body.position ?? 0 });
        if (!pack.name) throw new HTTPError("A pack needs a name", 400);
        if (body.banner_data) pack.banner_hash = (await uploadStoreArt(`${pack.id}/banner`, body.banner_data, "banner_data")).hash;
        if (body.logo_data) pack.logo_hash = (await uploadStoreArt(`${pack.id}/logo`, body.logo_data, "logo_data")).hash;
        await pack.save();
        Collectibles.reload();
        res.status(201).json(serializeStorePack(pack));
    },
);

export default router;
