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
import { GifProviderManager } from "@spacebar/integrations/gifs";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            limit: { type: "number", description: "Maximum number of terms" },
            locale: { type: "string", description: "Locale" },
            provider: { type: "string", description: "Provider to use" },
        },
        responses: { 200: {} },
    }),
    async (req: Request, res: Response) => {
        const provider = GifProviderManager.findProvider(req.query.provider as string);
        if (!provider) return res.json([]);
        const categories = await provider.getTrendingCategories({ media_format: "gif", locale: (req.query.locale as string) ?? "en" }).catch(() => []);
        res.json(categories.slice(0, Number(req.query.limit) || 5).map((category) => category.name));
    },
);

export default router;
