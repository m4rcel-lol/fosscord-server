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
import { getSearchableChannels, searchMessages, searchResponse, searchTabs } from "@spacebar/api/util";
import { getPermission } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

const channelIdsOf = (value: unknown) => (value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(String));

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GuildMessagesSearchResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            422: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        (await getPermission(req.user_id, guild_id)).hasThrow("VIEW_CHANNEL");
        const channels = await getSearchableChannels(req.user_id, guild_id, channelIdsOf(req.query.channel_id));
        res.json(searchResponse(req.user_id, await searchMessages(req.user_id, channels, req.query)));
    },
);

router.post(
    "/tabs",
    route({
        responses: {
            200: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        (await getPermission(req.user_id, guild_id)).hasThrow("VIEW_CHANNEL");
        const channels = await getSearchableChannels(req.user_id, guild_id, channelIdsOf(req.body.channel_ids));
        res.json(await searchTabs(req.user_id, channels, req.body));
    },
);

export default router;
