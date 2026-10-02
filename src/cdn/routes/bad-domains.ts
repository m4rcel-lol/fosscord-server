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
import { setCacheControlNotFound } from "../util";

const router = Router({ mergeParams: true });

const FILES: Record<string, string> = {
    "current_revision.txt": "text/plain",
    "updated_hashes.json": "application/json",
    "hashes.json": "application/json",
};
const TTL = 3_600_000;
const cache = new Map<string, { body: Buffer; expires: number }>();

router.get("/:file", async (req: Request, res: Response) => {
    const file = req.params.file as string;
    const type = FILES[file];
    if (!type) return setCacheControlNotFound(req, res);
    let entry = cache.get(file);
    if (!entry || entry.expires < Date.now()) {
        const upstream = await fetch(`https://cdn.discordapp.com/bad-domains/${file}`, { signal: AbortSignal.timeout(10000) }).catch(() => undefined);
        if (upstream?.ok) cache.set(file, (entry = { body: Buffer.from(await upstream.arrayBuffer()), expires: Date.now() + TTL }));
    }
    if (!entry) return setCacheControlNotFound(req, res);
    res.set("Content-Type", type);
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(entry.body);
});

export default router;
