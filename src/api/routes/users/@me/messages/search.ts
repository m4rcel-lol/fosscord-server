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
import { getSearchableChannels, searchTabs } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

router.post(
    "/tabs",
    route({
        responses: {
            200: {},
        },
    }),
    async (req: Request, res: Response) => {
        const ids = req.body.channel_ids === undefined ? [] : (Array.isArray(req.body.channel_ids) ? req.body.channel_ids : [req.body.channel_ids]).map(String);
        const channels = await getSearchableChannels(req.user_id, undefined, ids);
        res.json(await searchTabs(req.user_id, channels, { include_nsfw: true, ...req.body }));
    },
);

export default router;
