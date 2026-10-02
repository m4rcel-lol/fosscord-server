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
import { User } from "@spacebar/database";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

const CONSENT_TYPES = ["usage_statistics", "personalization"];

const serialize = (consents: Record<string, boolean> = {}) => Object.fromEntries(CONSENT_TYPES.map((type) => [type, { consented: !!consents[type] }]));

const load = (user_id: string) => User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });

router.get("/", route({}), async (req: Request, res: Response) => {
    const user = await load(req.user_id);
    res.json(serialize(user.account_preferences?.consents));
});

router.post("/", route({}), async (req: Request, res: Response) => {
    const { grant, revoke } = req.body as { grant?: unknown; revoke?: unknown };
    const user = await load(req.user_id);
    const consents = { ...user.account_preferences?.consents };
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => CONSENT_TYPES.includes(x)) : []);
    for (const type of list(grant)) consents[type] = true;
    for (const type of list(revoke)) consents[type] = false;
    await User.update({ id: req.user_id }, { account_preferences: { ...user.account_preferences, consents } });
    res.json(serialize(consents));
});

export default router;
