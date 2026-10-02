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
import { Badge, User } from "@spacebar/database";
import { AdminBadgeUpdateSchema } from "@spacebar/schemas";
import { resolveBadgeIcon, serializeBadge } from "../index";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminBadgeUpdateSchema", description: "Edit a profile badge" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminBadgeUpdateSchema;
        const badge = await Badge.findOneOrFail({ where: { id: req.params.badge_id as string } });

        const icon = await resolveBadgeIcon(body);
        if (icon) badge.icon = icon;
        if (body.description !== undefined) badge.description = body.description.trim();
        if (body.link !== undefined) Object.assign(badge, { link: body.link?.trim() || null });
        await badge.save();

        res.json(serializeBadge(badge));
    },
);

router.delete(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a profile badge and take it off everyone who has it", responses: { 204: {} } }),
    async (req: Request, res: Response) => {
        const id = req.params.badge_id as string;
        await Badge.findOneOrFail({ where: { id }, select: { id: true } });
        await User.query(`UPDATE "users" SET "badge_ids" = array_remove("badge_ids", $1::int8) WHERE $1::int8 = ANY("badge_ids")`, [id]);
        await Badge.delete({ id });
        res.sendStatus(204);
    },
);

export default router;
