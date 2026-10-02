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

import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { listDirectoryApplications } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (_req: Request, res: Response) => {
    const { applications } = await listDirectoryApplications("", 0, 24);
    if (!applications.length) return res.json([]);
    res.json([
        {
            id: "1",
            type: 1,
            position: 0,
            platforms: 0,
            active_state: 1,
            flags: 0,
            title: "Apps on this instance",
            description: "",
            application_directory_collection_items: applications.map((application, position) => ({
                id: application.id,
                type: 1,
                position,
                flags: 0,
                image_hash: null,
                application,
            })),
        },
    ]);
});

export default router;
