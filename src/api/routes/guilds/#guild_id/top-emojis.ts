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
import { Emoji, Message } from "@spacebar/database";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ permission: "VIEW_CHANNEL", responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const emojis = await Emoji.find({ where: { guild_id }, select: { id: true } });
    if (!emojis.length) return res.json({ items: [] });

    const usage: { id: string }[] = await Message.query(
        `SELECT r->'emoji'->>'id' AS id, SUM((r->>'count')::int) AS uses
         FROM (SELECT reactions FROM messages WHERE guild_id = $1 ORDER BY id DESC LIMIT 5000) recent, jsonb_array_elements(recent.reactions) r
         WHERE r->'emoji'->>'id' = ANY($2)
         GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
        [guild_id, emojis.map((emoji) => emoji.id)],
    ).catch(() => []);

    res.json({ items: usage.map(({ id }, i) => ({ emoji_id: id, emoji_rank: i + 1 })) });
});

export default router;
