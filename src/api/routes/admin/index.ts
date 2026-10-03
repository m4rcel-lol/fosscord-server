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
import { ADMIN_PANEL_RIGHTS } from "@spacebar/api/util";
import { Guild, Member, Message, Report, RESOLVED_INCIDENT_STATES, StatusIncident, User } from "@spacebar/database";
import { brandImageUrls, Config, getRevInfoOrFail, getRights, instanceName, SpacebarApiErrors } from "@spacebar/util";
import { In, Not } from "typeorm";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        description: "Instance overview for the admin dashboard, including which admin areas the caller can access",
    }),
    async (req: Request, res: Response) => {
        const rights = await getRights(req.user_id);
        if (!rights.any([...ADMIN_PANEL_RIGHTS])) throw SpacebarApiErrors.MISSING_RIGHTS.withParams(ADMIN_PANEL_RIGHTS.join(" | "));

        const [users, guilds, messages, members, disabledUsers, openIncidents, openReports] = await Promise.all([
            User.count({ where: { bot: false } }),
            Guild.count(),
            Message.count(),
            Member.count(),
            User.count({ where: { disabled: true } }),
            StatusIncident.count({ where: { status: Not(In(RESOLVED_INCIDENT_STATES)) } }),
            Report.count({ where: { status: "open" } }),
        ]);

        const general = Config.get().general;
        res.json({
            instance: {
                id: general.instanceId,
                name: instanceName(),
                description: general.instanceDescription,
                image: brandImageUrls().icon ?? general.image,
            },
            counts: { users, guilds, messages, members, disabled_users: disabledUsers, open_incidents: openIncidents, open_reports: openReports },
            uptime: process.uptime(),
            revision: getRevInfoOrFail(),
            access: {
                operator: rights.has("OPERATOR"),
                settings: rights.has("OPERATOR"),
                status: rights.has("OPERATOR"),
                users: rights.has("MANAGE_USERS"),
                guilds: rights.has("MANAGE_GUILDS"),
                reports: rights.has("MANAGE_USERS"),
                messages: rights.has("MANAGE_MESSAGES"),
                system: rights.has("OPERATOR"),
            },
        });
    },
);

export default router;
