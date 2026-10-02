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
import { Application } from "@spacebar/database";
import { Request, Response, Router } from "express";
import { In } from "typeorm";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const raw = req.query.application_ids;
    const ids = (Array.isArray(raw) ? raw : [raw]).flatMap((x) => String(x ?? "").split(",")).filter((x) => /^\d+$/.test(x));
    if (!ids.length) return res.json([]);

    const applications = await Application.find({ where: { id: In(ids.slice(0, 100)) } });
    res.json(
        applications.map((x) => ({
            id: x.id,
            name: x.name,
            icon: x.icon ?? null,
            description: x.description,
            summary: x.summary,
            type: null,
            cover_image: x.cover_image ?? null,
            flags: x.flags,
            bot_public: x.bot_public,
            bot_require_code_grant: x.bot_require_code_grant,
            verify_key: x.verify_key,
            tags: x.tags ?? [],
            install_params: x.install_params,
            custom_install_url: x.custom_install_url,
            terms_of_service_url: x.terms_of_service_url,
            privacy_policy_url: x.privacy_policy_url,
        })),
    );
});

export default router;
