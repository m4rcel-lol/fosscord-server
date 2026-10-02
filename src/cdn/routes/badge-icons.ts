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

import crypto from "node:crypto";
import { Router, Response, Request } from "express";
import { fileTypeFromBuffer } from "file-type";
import { Config } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { storage, multer, setCacheControl } from "../util";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const router = Router({ mergeParams: true });

// custom instance badges; clients always request `<icon>.png`, whatever the real format is
router.post("/", multer.single("file"), async (req: Request, res: Response) => {
    if (req.headers.signature !== Config.get().security.requestSignature) throw new HTTPError("Invalid request signature");
    if (!req.file) throw new HTTPError("Missing file");
    const { buffer, size } = req.file;

    const type = await fileTypeFromBuffer(buffer);
    if (!type || !ALLOWED_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");

    const hash = crypto.createHash("md5").update(buffer).digest("hex");
    await storage.set(`badge-icons/${hash}.png`, buffer);

    return res.json({ id: hash, content_type: type.mime, size, url: `${Config.get().cdn.endpointPublic}${req.baseUrl}/${hash}.png` });
});

router.get("/:badge_id", setCacheControl, async (req: Request, res: Response) => {
    const { badge_id } = req.params as { [key: string]: string };
    const path = `badge-icons/${badge_id}`;

    const file = await storage.get(path);
    if (!file) return res.redirect(`https://cdn.discordapp.com/badge-icons/${encodeURIComponent(badge_id)}`);
    const type = await fileTypeFromBuffer(file);

    res.set("Content-Type", type?.mime);

    return res.send(file);
});

export default router;
