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
import { AdminStatusIncidentCreateSchema } from "@spacebar/schemas";
import { serializeIncident, setComponentsStatus } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "List incidents and maintenance windows, newest first",
        query: { limit: { type: "number", required: false }, offset: { type: "number", required: false } },
    }),
    async (req: Request, res: Response) => {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const [incidents, total] = await StatusIncident.findAndCount({ order: { created_at: "DESC" }, take: limit, skip: offset });
        const components = await StatusComponent.find();
        res.json({ total, incidents: incidents.map((i) => serializeIncident(i, components)) });
    },
);

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStatusIncidentCreateSchema",
        description: "Open an incident, or schedule maintenance (impact: maintenance)",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStatusIncidentCreateSchema;
        const components = await StatusComponent.find();
        const componentIds = (body.component_ids ?? []).filter((id) => components.some((c) => c.id === id));
        const now = new Date();

        const incident = await StatusIncident.create({
            name: body.name.trim(),
            impact: body.impact,
            status: body.status,
            component_ids: componentIds,
            scheduled_for: body.scheduled_for ? new Date(body.scheduled_for) : null,
            scheduled_until: body.scheduled_until ? new Date(body.scheduled_until) : null,
            updates: [{ id: Snowflake.generate(), status: body.status, body: body.body.trim(), created_at: now.toISOString() }],
            created_at: now,
            updated_at: now,
            resolved_at: RESOLVED_INCIDENT_STATES.includes(body.status) ? now : null,
        }).save();

        // scheduled maintenance leaves components alone until it actually starts
        const componentStatus = body.component_status ?? (body.impact === "maintenance" ? (body.status === "in_progress" ? "under_maintenance" : undefined) : undefined);
        if (componentStatus && !RESOLVED_INCIDENT_STATES.includes(body.status)) await setComponentsStatus(componentIds, componentStatus);

        res.status(201).json(serializeIncident(incident, await StatusComponent.find()));
    },
);

export default router;
