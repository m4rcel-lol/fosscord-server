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
import { storage } from "@spacebar/cdn/util/Storage";
import { route } from "@spacebar/api/middlewares";
import { harvestPath, readTicket } from "@spacebar/api/util";
import { HTTPError } from "lambert-server/HTTPError";

const router = Router({ mergeParams: true });

router.get("/", route({ authentication: "never", responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const decoded = readTicket<{ typ: string; uid?: string; hid?: string }>(req.params.token, "harvest");
    if (!decoded?.uid || !decoded.hid) throw new HTTPError("Unknown data package", 404);
    const file = await storage.get(harvestPath(decoded.uid, decoded.hid));
    if (!file) throw new HTTPError("Unknown data package", 404);
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="package-${decoded.hid}.zip"`);
    res.send(file);
});

export default router;
