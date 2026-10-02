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
import { route } from "@spacebar/api/middlewares";
import { StatusComponent } from "@spacebar/database";
import { AdminStatusComponentSchema } from "@spacebar/schemas";
import { serializeComponent } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "List status page components" }), async (req: Request, res: Response) => {
    res.json((await StatusComponent.find({ order: { position: "ASC", id: "ASC" } })).map(serializeComponent));
});

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminStatusComponentSchema", description: "Add a status page component" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStatusComponentSchema;
        const last = await StatusComponent.findOne({ where: {}, order: { position: "DESC" }, select: { position: true } });
        const component = await StatusComponent.create({
            name: body.name.trim(),
            description: body.description?.trim() || null,
            status: body.status ?? "operational",
            position: body.position ?? (last ? last.position + 1 : 0),
        }).save();
        res.status(201).json(serializeComponent(component));
    },
);

export default router;
