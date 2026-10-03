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

import fs from "node:fs/promises";
import path from "node:path";
import express, { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { PUBLIC_ASSETS_FOLDER, instanceName } from "@spacebar/util";

const router = Router({ mergeParams: true });
const PAGE_FOLDER = path.join(PUBLIC_ASSETS_FOLDER, "admin");

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const page = await fs.readFile(path.join(PAGE_FOLDER, "index.html"), "utf8");
        const name = instanceName().replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
        res.set("Cache-Control", "no-cache").type("html").send(page.replaceAll("__INSTANCE_NAME__", name));
    },
);

// the page's own scripts and styles, so it works outside the bundle too (where /assets isn't served)
router.use(express.static(PAGE_FOLDER, { index: false, setHeaders: (res) => res.set("Cache-Control", "no-cache") }));

export default router;
