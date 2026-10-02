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
import { launchActivity } from "@spacebar/api/activities";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const { session_id } = (req.body ?? {}) as { session_id?: string };
    const { data } = await launchActivity({
        userId: req.user_id,
        applicationId: req.params.application_id as string,
        channelId: req.params.channel_id as string,
        sessionId: typeof session_id === "string" ? session_id : undefined,
    });
    res.json(data);
});

export default router;
