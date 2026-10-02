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
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { GuildScheduledEventUser } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const raw = req.query.guild_ids;
    const guildIds = (Array.isArray(raw) ? raw : raw ? String(raw).split(",") : [])
        .map(String)
        .filter((id) => /^\d+$/.test(id))
        .slice(0, 200);
    if (!guildIds.length) return res.json([]);
    const rows = await GuildScheduledEventUser.find({ where: { user_id: req.user_id, guild_id: In(guildIds) } });
    res.json(rows.map((row) => row.toJSON()));
});

export default router;
