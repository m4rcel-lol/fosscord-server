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
import { Member } from "@spacebar/database";
import { DefaultUserGuildSettings, UserGuildSettings } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.patch("/", route({}), async (req: Request, res: Response) => {
    const { guilds } = req.body as { guilds?: Record<string, Partial<UserGuildSettings>> };

    const entries = await Promise.all(
        Object.entries(guilds ?? {}).map(async ([guild_id, settings]) => {
            if (guild_id === "null" || guild_id === "@me")
                return {
                    ...DefaultUserGuildSettings,
                    ...settings,
                    guild_id: null,
                    channel_overrides: Object.entries(settings.channel_overrides ?? {}).map(([channel_id, o]) => ({ ...o, channel_id })),
                };
            return Member.updateGuildSettings(req.user_id, guild_id, settings);
        }),
    );

    res.json(entries);
});

export default router;
