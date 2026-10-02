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
import { StatusComponent, StatusIncident } from "@spacebar/database";
import { AdminStatusComponentUpdateSchema } from "@spacebar/schemas";
import { serializeComponent } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminStatusComponentUpdateSchema", description: "Edit a status page component" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStatusComponentUpdateSchema;
        const component = await StatusComponent.findOneOrFail({ where: { id: req.params.component_id as string } });
        if (body.name !== undefined) component.name = body.name.trim();
        if (body.description !== undefined) component.description = body.description?.trim() || null;
        if (body.status !== undefined) component.status = body.status;
        if (body.position !== undefined) component.position = body.position;
        component.updated_at = new Date();
        await component.save();
        res.json(serializeComponent(component));
    },
);

router.delete("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Remove a status page component", responses: { 204: {} } }), async (req: Request, res: Response) => {
    const id = req.params.component_id as string;
    await StatusComponent.findOneOrFail({ where: { id }, select: { id: true } });
    await StatusIncident.query(`UPDATE "status_incidents" SET "component_ids" = array_remove("component_ids", $1::int8)`, [id]);
    await StatusComponent.delete({ id });
    res.sendStatus(204);
});

export default router;
