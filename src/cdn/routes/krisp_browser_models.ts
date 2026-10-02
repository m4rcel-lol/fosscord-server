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

router.get("/:version/:file", setCacheControl, async (req: Request, res: Response) => {
    const { version, file } = req.params as { [key: string]: string };
    if (!/^v[\w.-]{1,32}$/.test(version) || !/^[\w-]{1,64}\.kw$/.test(file)) return setCacheControlNotFound(req, res);
    const path = `krisp_browser_models/${version}/${file}`;
    const data = (await storage.get(path)) ?? (await fetchUpstreamAsset(path, `https://cdn.discordapp.com/assets/${path}`));
    if (!data) return setCacheControlNotFound(req, res);
    return sendAsset(res, data, file);
});

export default router;
