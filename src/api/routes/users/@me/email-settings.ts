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

import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

const DEFAULT_CATEGORIES: Record<string, boolean> = {
    social: true,
    communication: true,
    tips: false,
    updates_and_announcements: false,
    recommendations_and_events: false,
    family_center_digest: false,
};

const load = (user_id: string) => User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });

const serialize = (user: User) => ({
    categories: { ...DEFAULT_CATEGORIES, ...user.account_preferences?.email_categories },
    initialized: !!user.account_preferences?.email_settings_initialized,
});

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json(serialize(await load(req.user_id)));
});

router.patch("/", route({}), async (req: Request, res: Response) => {
    const { settings } = req.body as { settings?: { categories?: Record<string, unknown>; initialized?: unknown } };
    const user = await load(req.user_id);
    const email_categories = { ...user.account_preferences?.email_categories };
    for (const [category, enabled] of Object.entries(settings?.categories ?? {}))
        if (category in DEFAULT_CATEGORIES && typeof enabled === "boolean") email_categories[category] = enabled;
    user.account_preferences = { ...user.account_preferences, email_categories, email_settings_initialized: true };
    await User.update({ id: req.user_id }, { account_preferences: user.account_preferences });
    res.json(serialize(user));
});

export default router;
