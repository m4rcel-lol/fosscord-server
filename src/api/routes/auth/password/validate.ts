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
import { Config } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "optional", spacebarOnly: false }), (req: Request, res: Response) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const min = Config.get().register.password.minLength ?? 8;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((x) => x.test(password)).length;
    const unique = new Set(password).size;
    const score = password.length < min ? 0 : Math.min(4, Math.floor(classes / 2) + (password.length >= 12 ? 1 : 0) + (password.length >= 16 ? 1 : 0) + (unique >= 8 ? 1 : 0));
    res.json({ valid: password.length >= min && password.length <= 72, password_strength: score });
});

export default router;
