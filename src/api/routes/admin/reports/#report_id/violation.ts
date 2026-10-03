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
import { AdminViolationCreateSchema } from "@spacebar/schemas";
import { describeReports, issueViolation } from "@spacebar/api/util";
import { HTTPError } from "lambert-server/HTTPError";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        requestBody: "AdminViolationCreateSchema",
        description: "Issue a violation to the reported user and close the report as actioned",
    }),
    async (req: Request, res: Response) => {
        const report = await UserReport.findOneOrFail({ where: { id: req.params.report_id as string } });
        if (!report.reported_user_id) throw new HTTPError("This report isn't about a user.", 400);
        const snapshot = report.snapshot;
        const flagged =
            snapshot && report.message_id
                ? [
                      {
                          id: report.message_id,
                          content: snapshot.content ?? "",
                          attachments: (snapshot.attachments ?? []).map((a) => ({ id: a.id, url: a.url, filename: a.filename })),
                      },
                  ]
                : [];
        const violation = await issueViolation(report.reported_user_id, req.body as AdminViolationCreateSchema, req.user_id, flagged);

        const related = await UserReport.find({
            where: report.message_id
                ? { message_id: report.message_id, status: UserReportStatus.OPEN }
                : { reported_user_id: report.reported_user_id, type: report.type, status: UserReportStatus.OPEN },
        });
        for (const entry of [report, ...related.filter((r) => r.id !== report.id)]) {
            entry.status = UserReportStatus.ACTIONED;
            entry.resolved_by = req.user_id;
            entry.resolved_at = new Date();
            entry.violation_id = violation.id;
            await entry.save();
        }
        const [described] = await describeReports([report], { ip: req.ip, userAgent: req.headers["user-agent"] });
        res.status(201).json(described);
    },
);

export default router;
