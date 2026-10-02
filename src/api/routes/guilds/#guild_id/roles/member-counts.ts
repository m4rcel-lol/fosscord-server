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
import { Role, Member } from "@spacebar/database";
import { route } from "@spacebar/api/middlewares";

const router: Router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    await Member.IsInGuildOrFail(req.user_id, guild_id);

    const [role_ids, rows] = await Promise.all([
        Role.find({ where: { guild_id }, select: { id: true } }),
        Member.query(`SELECT mr.role_id, COUNT(DISTINCT m.id)::int AS count FROM member_roles mr JOIN members m ON m.index = mr.index WHERE m.guild_id = $1 GROUP BY mr.role_id`, [
            guild_id,
        ]) as Promise<{ role_id: string; count: number }[]>,
    ]);
    const byRole = new Map(rows.map((x) => [`${x.role_id}`, x.count]));
    const counts: { [id: string]: number } = Object.fromEntries(role_ids.map(({ id }) => [id, byRole.get(id) ?? 0]));

    return res.json(counts);
});

export default router;
