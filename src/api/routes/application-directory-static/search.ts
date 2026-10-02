/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

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

import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { listDirectoryApplications } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const pageSize = Math.min(Math.max(Number(req.query.page_size) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { applications, total } = await listDirectoryApplications(String(req.query.query ?? ""), (page - 1) * pageSize, pageSize);
    res.json({
        results: applications.map((data) => ({ type: 1, data })),
        counts_by_category: {},
        result_count: total,
        num_pages: Math.ceil(total / pageSize),
        type: 1,
        load_id: randomUUID(),
    });
});

export default router;
