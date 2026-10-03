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
import { StoreItem, StorePack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStorePackUpdateSchema } from "@spacebar/schemas";
import { deleteAllStoreArt, deleteStoreArt, serializeStorePack, uploadStoreArt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const findPack = (req: Request) => StorePack.findOneOrFail({ where: { id: req.params.pack_id as string } });

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminStorePackUpdateSchema", description: "Change a store pack's name, summary, art or position" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStorePackUpdateSchema;
        const pack = await findPack(req);
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("A pack needs a name", 400);
            pack.name = body.name.trim();
        }
        if (body.summary !== undefined) pack.summary = body.summary.trim();
        if (body.position !== undefined) pack.position = body.position;
        for (const slot of ["banner", "logo"] as const) {
            const data = body[`${slot}_data`];
            if (data === undefined) continue;
            if (data === null) {
                await deleteStoreArt(`${pack.id}/${slot}`);
                pack[`${slot}_hash`] = null;
            } else pack[`${slot}_hash`] = (await uploadStoreArt(`${pack.id}/${slot}`, data, `${slot}_data`)).hash;
        }
        await pack.save();
        Collectibles.reload();
        res.json(serializeStorePack(pack, await StoreItem.find({ where: { pack_id: pack.id } })));
    },
);

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Delete a store pack and its items; people who have them stop seeing them on profiles",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const pack = await findPack(req);
        const items = await StoreItem.find({ where: { pack_id: pack.id } });
        await Promise.all([...items.map(deleteAllStoreArt), deleteStoreArt(`${pack.id}/banner`), deleteStoreArt(`${pack.id}/logo`)]);
        await StorePack.delete({ id: pack.id });
        Collectibles.reload();
        res.sendStatus(204);
    },
);

export default router;
