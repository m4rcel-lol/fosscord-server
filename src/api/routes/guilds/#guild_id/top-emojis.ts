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
import { Emoji, Member, getDatabase } from "@spacebar/database";

const router = Router({ mergeParams: true });

const cache = new Map<string, { at: number; items: { emoji_id: string; emoji_rank: number }[] }>();

router.get(
    "/",
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
        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const cached = cache.get(guild_id);
        if (cached && Date.now() - cached.at < 10 * 60 * 1000) return res.json({ items: cached.items });

        const emojis = await Emoji.find({ where: { guild_id }, select: { id: true } });
        if (!emojis.length) return res.json({ items: [] });

        const rows: { emoji_id: string; uses: string }[] = await getDatabase()!.query(
            `WITH recent AS (
                SELECT content, reactions FROM messages
                WHERE channel_id IN (SELECT id FROM channels WHERE guild_id = $1)
                ORDER BY id DESC LIMIT 5000
            ), used AS (
                SELECT r->'emoji'->>'id' AS emoji_id, COALESCE((r->>'count')::int, 1) AS uses
                FROM recent, jsonb_array_elements(COALESCE(recent.reactions, '[]'::jsonb)) r
                UNION ALL
                SELECT (regexp_matches(COALESCE(content, ''), '<a?:\\w+:(\\d+)>', 'g'))[1], 1 FROM recent
            )
            SELECT emoji_id, SUM(uses) AS uses FROM used
            WHERE emoji_id = ANY($2)
            GROUP BY emoji_id ORDER BY uses DESC LIMIT 20`,
            [guild_id, emojis.map((e) => e.id)],
        );

        const items = rows.map((row, i) => ({ emoji_id: row.emoji_id, emoji_rank: i + 1 }));
        cache.set(guild_id, { at: Date.now(), items });
        return res.json({ items });
    },
);

export default router;
