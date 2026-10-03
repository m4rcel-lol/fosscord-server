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
import { FindOptionsWhere, In, LessThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { UserReport, UserReportStatus } from "@spacebar/database";
import { describeReports } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        description: "Reports users sent in with the report menus, newest first",
        query: {
            status: { type: "string", required: false, description: "open | actioned | dismissed | all" },
            user_id: { type: "string", required: false, description: "Only reports against this user" },
            before: { type: "string", required: false },
            limit: { type: "number", required: false },
        },
    }),
    async (req: Request, res: Response) => {
        const statuses: Record<string, UserReportStatus[]> = {
            open: [UserReportStatus.OPEN],
            actioned: [UserReportStatus.ACTIONED],
            dismissed: [UserReportStatus.DISMISSED],
            all: [UserReportStatus.OPEN, UserReportStatus.ACTIONED, UserReportStatus.DISMISSED],
        };
        const status = statuses[String(req.query.status ?? "open")] ?? statuses.open;
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const where: FindOptionsWhere<UserReport> = { status: In(status) };
        if (typeof req.query.user_id === "string" && /^\d{1,20}$/.test(req.query.user_id)) where.reported_user_id = req.query.user_id;
        if (typeof req.query.before === "string" && /^\d{1,20}$/.test(req.query.before)) where.id = LessThan(req.query.before);

        const [reports, open, actioned, dismissed] = await Promise.all([
            UserReport.find({ where, order: { id: "DESC" }, take: limit }),
            UserReport.count({ where: { status: UserReportStatus.OPEN } }),
            UserReport.count({ where: { status: UserReportStatus.ACTIONED } }),
            UserReport.count({ where: { status: UserReportStatus.DISMISSED } }),
        ]);
        res.json({
            reports: await describeReports(reports, { ip: req.ip, userAgent: req.headers["user-agent"] }),
            counts: { open, actioned, dismissed },
        });
    },
);

export default router;
