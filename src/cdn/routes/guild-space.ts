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
import { HTTPError } from "lambert-server/HTTPError";
import { Config } from "@spacebar/util";
import { storage, multer, setCacheControl, setCacheControlNotFound } from "../util";

const ANIMATED_MIME_TYPES = ["image/apng", "image/gif", "image/gifv"];
const ALLOWED_MIME_TYPES = [...ANIMATED_MIME_TYPES, "image/png", "image/jpeg", "image/webp"];

const router = Router({ mergeParams: true });

router.post("/:guild_id/banner", multer.single("file"), async (req: Request, res: Response) => {
    if (req.headers.signature !== Config.get().security.requestSignature) throw new HTTPError("Invalid request signature");
    if (!req.file) throw new HTTPError("Missing file");
    const { buffer, size } = req.file;
    const { guild_id } = req.params as { [key: string]: string };

    const type = await fileTypeFromBuffer(buffer);
    if (!type || !ALLOWED_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");
    const md5 = crypto.createHash("md5").update(buffer).digest("hex");
    const hash = ANIMATED_MIME_TYPES.includes(type.mime) ? `a_${md5}` : md5;

    await storage.set(`guild-space/${guild_id}/banner/${hash}`, buffer);

    return res.json({
        id: hash,
        content_type: type.mime,
        size,
        url: `${Config.get().cdn.endpointPublic}${req.baseUrl}/${guild_id}/banner/${hash}`,
    });
});

router.get("/:guild_id/banner/:hash", setCacheControl, async (req: Request, res: Response) => {
    const { guild_id, hash } = req.params as { [key: string]: string };
    const file = await storage.get(`guild-space/${guild_id}/banner/${hash.split(".")[0]}`);
    if (!file) return setCacheControlNotFound(req, res);
    const type = await fileTypeFromBuffer(file);

    res.set("Content-Type", type?.mime);
    return res.send(file);
});

export default router;
