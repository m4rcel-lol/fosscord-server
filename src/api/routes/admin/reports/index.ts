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
import { Report } from "@spacebar/database";
import { describeReports } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const STATUSES = ["open", "resolved", "dismissed"];

router.get(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        description: "The report queue, newest first. `status` is open, resolved, dismissed or all.",
        query: {
            status: { type: "string", required: false },
            user_id: { type: "string", required: false, description: "Only reports against this user" },
            limit: { type: "number", required: false },
            offset: { type: "number", required: false },
        },
    }),
    async (req: Request, res: Response) => {
        const status = String(req.query.status ?? "open");
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const userId = /^\d{1,20}$/.test(String(req.query.user_id ?? "")) ? String(req.query.user_id) : undefined;

        const where = { ...(STATUSES.includes(status) ? { status: status as Report["status"] } : {}), ...(userId ? { reported_user_id: userId } : {}) };
        const [[reports, total], counts] = await Promise.all([
            Report.findAndCount({ where, order: { created_at: "DESC" }, take: limit, skip: offset }),
            Report.createQueryBuilder("r").select("r.status", "status").addSelect("COUNT(*)", "count").groupBy("r.status").getRawMany<{ status: string; count: string }>(),
        ]);

        res.json({
            total,
            counts: Object.fromEntries(STATUSES.map((s) => [s, Number(counts.find((c) => c.status === s)?.count ?? 0)])),
            reports: await describeReports(reports),
        });
    },
);

export default router;
