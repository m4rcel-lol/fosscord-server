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

import { route } from "@spacebar/api/middlewares";
import { ProfileWidget, User } from "@spacebar/database";
import { FieldErrors, Snowflake } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

const MAX_WIDGETS = 12;
const MAX_WIDGET_SIZE = 16 * 1024;

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, profile_widgets: true } });
    res.json({ widgets: user.profile_widgets ?? [] });
});

router.put("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { widgets } = req.body as { widgets?: unknown };
    if (!Array.isArray(widgets) || widgets.length > MAX_WIDGETS)
        throw FieldErrors({ widgets: { code: "BASE_TYPE_BAD_LENGTH", message: `Must be between 0 and ${MAX_WIDGETS} in length.` } });

    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, profile_widgets: true } });
    const existing = new Set((user.profile_widgets ?? []).map((x) => x.id));
    const next: ProfileWidget[] = widgets.map((widget, i) => {
        const { id, data } = (widget ?? {}) as { id?: unknown; data?: { type?: unknown } };
        if (typeof data?.type !== "string" || JSON.stringify(data).length > MAX_WIDGET_SIZE)
            throw FieldErrors({ [`widgets.${i}.data`]: { code: "BASE_TYPE_INVALID", message: "Invalid widget." } });
        return { id: typeof id === "string" && existing.has(id) ? id : Snowflake.generate(), data: data as ProfileWidget["data"] };
    });

    await User.update({ id: req.user_id }, { profile_widgets: next });
    res.json({ widgets: next });
});

export default router;
