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
import { storage, setCacheControl, setCacheControlNotFound, fetchUpstreamAsset, sendAsset } from "../util";

const router = Router({ mergeParams: true });

router.get("/:file", setCacheControl, async (req: Request, res: Response) => {
    const file = req.params.file as string;
    if (!/^[0-9a-f]{32,64}(\.[a-z0-9]{2,6})?$/i.test(file)) return setCacheControlNotFound(req, res);
    const path = `content-assets/${file}`;
    const data = (await storage.get(path)) ?? (await fetchUpstreamAsset(path, `https://cdn.discordapp.com/assets/content/${file}`));
    if (!data) return setCacheControlNotFound(req, res);
    return sendAsset(res, data, file);
});

export default router;
