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
import { AdminStatusIncidentUpdateSchema } from "@spacebar/schemas";
import { releaseComponents, serializeIncident } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStatusIncidentUpdateSchema",
        description: "Edit an incident's title, impact, components or maintenance window (post an update to change its status)",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStatusIncidentUpdateSchema;
        const incident = await StatusIncident.findOneOrFail({ where: { id: req.params.incident_id as string } });
        const components = await StatusComponent.find();

        if (body.name !== undefined) incident.name = body.name.trim();
        if (body.impact !== undefined) incident.impact = body.impact;
        if (body.component_ids !== undefined) incident.component_ids = body.component_ids.filter((id) => components.some((c) => c.id === id));
        if (body.scheduled_for !== undefined) incident.scheduled_for = body.scheduled_for ? new Date(body.scheduled_for) : null;
        if (body.scheduled_until !== undefined) incident.scheduled_until = body.scheduled_until ? new Date(body.scheduled_until) : null;
        incident.updated_at = new Date();
        await incident.save();

        res.json(serializeIncident(incident, components));
    },
);

router.delete("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Delete an incident entirely", responses: { 204: {} } }), async (req: Request, res: Response) => {
    const incident = await StatusIncident.findOneOrFail({ where: { id: req.params.incident_id as string } });
    await StatusIncident.delete({ id: incident.id });
    await releaseComponents(incident);
    res.sendStatus(204);
});

export default router;
