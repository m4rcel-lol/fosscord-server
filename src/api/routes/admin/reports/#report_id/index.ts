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
import { UserReport, UserReportStatus } from "@spacebar/database";
import { describeReports } from "@spacebar/api/util";
import { FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.patch("/", route({ right: "MANAGE_USERS", spacebarOnly: true, description: "Dismiss a report, or reopen one" }), async (req: Request, res: Response) => {
    const report = await UserReport.findOneOrFail({ where: { id: req.params.report_id as string } });
    const status = Number(req.body?.status);
    if (![UserReportStatus.OPEN, UserReportStatus.DISMISSED].includes(status))
        throw FieldErrors({ status: { code: "BASE_TYPE_CHOICES", message: "Status must be 0 (open) or 2 (dismissed)." } });
    report.status = status;
    report.resolved_by = status === UserReportStatus.OPEN ? null : req.user_id;
    report.resolved_at = status === UserReportStatus.OPEN ? null : new Date();
    await report.save();
    const [described] = await describeReports([report], { ip: req.ip, userAgent: req.headers["user-agent"] });
    res.json(described);
});

export default router;
