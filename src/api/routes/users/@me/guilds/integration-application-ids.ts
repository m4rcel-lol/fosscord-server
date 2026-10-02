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
import { Member } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const rows: { guild_id: string; application_id: string }[] = await Member.createQueryBuilder("bot")
        .select("bot.guild_id", "guild_id")
        .addSelect("bot.id", "application_id")
        .innerJoin("bot.user", "user", "user.bot = true")
        .innerJoin(Member, "me", "me.guild_id = bot.guild_id AND me.id = :user_id", { user_id: req.user_id })
        .getRawMany();

    const result: Record<string, string[]> = {};
    for (const { guild_id, application_id } of rows) (result[guild_id] ??= []).push(`${application_id}`);
    res.json(result);
});

export default router;
