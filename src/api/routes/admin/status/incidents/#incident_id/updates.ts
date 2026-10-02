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
import { RESOLVED_INCIDENT_STATES, StatusComponent, StatusIncident } from "@spacebar/database";
import { Snowflake } from "@spacebar/util";
import { AdminStatusIncidentPostUpdateSchema } from "@spacebar/schemas";
import { releaseComponents, serializeIncident, setComponentsStatus } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStatusIncidentPostUpdateSchema",
        description: "Post a timeline update to an incident, which also moves it to the given status",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStatusIncidentPostUpdateSchema;
        const incident = await StatusIncident.findOneOrFail({ where: { id: req.params.incident_id as string } });
        const wasResolved = RESOLVED_INCIDENT_STATES.includes(incident.status);
        const now = new Date();

        incident.updates = [...incident.updates, { id: Snowflake.generate(), status: body.status, body: body.body.trim(), created_at: now.toISOString() }];
        incident.status = body.status;
        incident.updated_at = now;
        const isResolved = RESOLVED_INCIDENT_STATES.includes(body.status);
        if (isResolved && !wasResolved) incident.resolved_at = now;
        if (!isResolved) incident.resolved_at = null;
        await incident.save();

        if (isResolved) await releaseComponents(incident);
        else if (incident.is_maintenance && body.status === "in_progress") await setComponentsStatus(incident.component_ids, "under_maintenance");

        res.json(serializeIncident(incident, await StatusComponent.find()));
    },
);

export default router;
