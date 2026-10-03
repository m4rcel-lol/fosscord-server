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
import { StoreItem } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStoreItemUpdateSchema } from "@spacebar/schemas";
import { applyStoreArt, applyStoreItemSettings, assertKeepsMainArt, deleteAllStoreArt, serializeStoreItem } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const findItem = (req: Request) => StoreItem.findOneOrFail({ where: { id: req.params.item_id as string } });

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminStoreItemUpdateSchema", description: "Change a store item's details or art" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStoreItemUpdateSchema;
        const item = await findItem(req);
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("An item needs a name", 400);
            item.name = body.name.trim();
        }
        if (body.summary !== undefined) item.summary = body.summary.trim();
        if (body.label !== undefined) item.label = body.label.trim();
        if (body.position !== undefined) item.position = body.position;
        applyStoreItemSettings(item, body);
        // removing the main art would take the item out of the shop and off everyone's profile
        assertKeepsMainArt(item, body.art);
        await applyStoreArt(item, body.art);
        item.data = { ...item.data };
        await item.save();
        Collectibles.reload();
        res.json(serializeStoreItem(item));
    },
);

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Delete a store item; people who have it stop seeing it on profiles",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const item = await findItem(req);
        await deleteAllStoreArt(item);
        await StoreItem.delete({ id: item.id });
        Collectibles.reload();
        res.sendStatus(204);
    },
);

export default router;
