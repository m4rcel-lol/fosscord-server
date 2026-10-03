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

import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { Collectibles } from "@spacebar/util";

const router = Router({ mergeParams: true });

const list = (value: unknown) =>
    [value]
        .flat()
        .flatMap((x) => (typeof x === "string" ? x.split(",") : []))
        .filter(Boolean);
const number = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined);

// the shop's browse tabs and search box
router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { item_types, search, sort_type, sort_direction, offset, limit, is_first_party } = req.query;
    res.json(
        await Collectibles.search({
            item_types: list(item_types),
            search: typeof search === "string" ? search.slice(0, 100) : undefined,
            sort_type: typeof sort_type === "string" ? sort_type : undefined,
            sort_direction: typeof sort_direction === "string" ? sort_direction : undefined,
            offset: number(offset),
            limit: number(limit),
            first_party: is_first_party === "false" ? false : undefined,
        }),
    );
});

export default router;
