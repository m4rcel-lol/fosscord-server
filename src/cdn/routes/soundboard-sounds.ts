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

const ALLOWED_MIME_TYPES = ["audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/vnd.wave", "audio/webm", "audio/mp4", "audio/aac", "audio/x-m4a"];
const pathPrefix = "soundboard-sounds";

const router = Router({ mergeParams: true });

router.post("/:sound_id", multer.single("file"), async (req: Request, res: Response) => {
    if (req.headers.signature !== Config.get().security.requestSignature) throw new HTTPError("Invalid request signature");
    if (!req.file) throw new HTTPError("Missing file");
    const { buffer, size } = req.file;
    const { sound_id } = req.params as { [key: string]: string };

    const type = await fileTypeFromBuffer(buffer);
    if (!type || !ALLOWED_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");

    await storage.set(`${pathPrefix}/${sound_id}`, buffer);

    return res.json({
        id: crypto.createHash("md5").update(buffer).digest("hex"),
        content_type: type.mime,
        size,
        url: `${Config.get().cdn.endpointPublic}${req.baseUrl}/${sound_id}`,
    });
});

router.get("/:sound_id", setCacheControl, async (req: Request, res: Response) => {
    const soundId = (req.params.sound_id as string).split(".")[0];
    const file = await storage.get(`${pathPrefix}/${soundId}`);
    if (!file) return setCacheControlNotFound(req, res);
    const type = await fileTypeFromBuffer(file);
    res.set("Content-Type", type?.mime ?? "audio/ogg");
    return res.send(file);
});

router.delete("/:sound_id", async (req: Request, res: Response) => {
    if (req.headers.signature !== Config.get().security.requestSignature) throw new HTTPError("Invalid request signature");
    await storage.delete(`${pathPrefix}/${req.params.sound_id as string}`);
    return res.send({ success: true });
});

export default router;
