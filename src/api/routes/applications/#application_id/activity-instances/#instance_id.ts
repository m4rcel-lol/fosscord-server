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
import { ActivityInstances } from "@spacebar/database";
import { ApiError, DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const applicationId = req.params.application_id as string;
    if (req.user_id !== applicationId) throw DiscordApiErrors.MISSING_ACCESS;
    const instance = await ActivityInstances.find(applicationId, req.params.instance_id as string);
    if (!instance) throw new ApiError("Unknown activity instance", 10070, 404);
    const data = await ActivityInstances.serialize(instance);
    res.json({
        application_id: data.application_id,
        instance_id: data.composite_instance_id,
        launch_id: data.launch_id,
        location: data.location,
        users: data.participants.map((p) => p.user_id),
    });
});

export default router;
