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

import { Router, Response, Request } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { fileTypeFromBuffer } from "file-type";
import { storage, setCacheControl, setCacheControlNotFound, multer, validateServerAuth, fetchUpstreamAsset, sendAsset } from "../../../util";
import { Config } from "@spacebar/util";
import crypto from "node:crypto";

const ANIMATED_MIME_TYPES = ["image/apng", "image/gif", "image/gifv"];
const STATIC_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml", "image/svg"];

const router = Router({ mergeParams: true });

router.get("/:sku_id/static", setCacheControl, async (req: Request, res: Response) => {
    const { sku_id } = req.params as { [key: string]: string };
    const basePath = `collectibles-shop/${sku_id}`;

    let file: Buffer<ArrayBufferLike> | null;
    if (await storage.exists(basePath + "/static")) {
        file = await storage.get(basePath + "/static");
    } else if (await storage.exists(basePath + "/animated")) {
        file = await storage.get(basePath + "/animated");
    } else return sendUpstream(req, res, `${sku_id}/static`);

    const type = await fileTypeFromBuffer(file!);

    res.set("Content-Type", type?.mime);

    return res.send(file);
});

router.get("/:sku_id/animated", setCacheControl, async (req: Request, res: Response) => {
    const { sku_id } = req.params as { [key: string]: string };
    const basePath = `collectibles-shop/${sku_id}`;

    let file: Buffer<ArrayBufferLike> | null;
    if (await storage.exists(basePath + "/animated")) {
        file = await storage.get(basePath + "/animated");
    } else if (await storage.exists(basePath + "/static")) {
        file = await storage.get(basePath + "/static");
    } else return sendUpstream(req, res, `${sku_id}/animated`);

    const type = await fileTypeFromBuffer(file!);

    res.set("Content-Type", type?.mime);

    return res.send(file);
});

// any other art (nameplate videos, frame layers, the admin panel's uploads) is served from storage first
router.get("/*path", setCacheControl, async (req: Request, res: Response) => {
    const asset = ([req.params.path].flat() as string[]).join("/");
    if (!validAssetPath(asset)) return setCacheControlNotFound(req, res);
    const file = await storage.get(`collectibles-shop/${asset}`);
    if (!file) return sendUpstream(req, res, asset);
    res.set("Content-Type", (await fileTypeFromBuffer(file))?.mime ?? "application/octet-stream");
    return res.send(file);
});

const validAssetPath = (asset: string) => {
    const segments = asset.split("/");
    return segments.length <= 4 && segments.every((x) => /^[a-z0-9_-]{1,64}$/i.test(x));
};

async function sendUpstream(req: Request, res: Response, asset: string) {
    if (!validAssetPath(asset)) return setCacheControlNotFound(req, res);
    const path = `collectibles-shop-upstream/${asset}`;
    const file = (await storage.get(path)) ?? (await fetchUpstreamAsset(path, `https://cdn.discordapp.com/media/v1/collectibles-shop/${asset}`));
    if (!file) return setCacheControlNotFound(req, res);
    return sendAsset(res, file, asset);
}

router.post("/:sku_id/animated", validateServerAuth, multer.single("file"), async (req: Request, res: Response) => {
    if (!req.file) throw new HTTPError("Missing file");
    const { buffer, size } = req.file;
    const { sku_id } = req.params as { [key: string]: string };

    let hash = crypto.createHash("md5").update(buffer).digest("hex");

    const type = await fileTypeFromBuffer(buffer);
    if (!type || !ANIMATED_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");
    if (ANIMATED_MIME_TYPES.includes(type.mime)) hash = `a_${hash}`; // animated icons have a_ infront of the hash

    const path = `collectibles-shop/${sku_id}/animated`;
    await storage.set(path, buffer);

    return res.json({
        id: sku_id,
        hash: hash,
        content_type: type.mime,
        size,
        url: `${Config.get().cdn.endpointPublic}media/v1/collectibles-shop/${sku_id}/animated`,
    });
});

router.post("/:sku_id/static", validateServerAuth, multer.single("file"), async (req: Request, res: Response) => {
    if (!req.file) throw new HTTPError("Missing file");
    const { buffer, size } = req.file;
    const { sku_id } = req.params as { [key: string]: string };

    const hash = crypto.createHash("md5").update(buffer).digest("hex");

    const type = await fileTypeFromBuffer(buffer);
    if (!type || !STATIC_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");

    const path = `collectibles-shop/${sku_id}/static`;
    await storage.set(path, buffer);

    return res.json({
        id: sku_id,
        hash: hash,
        content_type: type.mime,
        size,
        url: `${Config.get().cdn.endpointPublic}media/v1/collectibles-shop/${sku_id}/static`,
    });
});

// the admin panel's store uploads: any art slot under a SKU, such as <sku>/video or <sku>/<layer id>/static
const UPLOAD_MIME_TYPES = [...STATIC_MIME_TYPES, ...ANIMATED_MIME_TYPES, "video/webm", "video/mp4"];

router.post("/*path", validateServerAuth, multer.single("file"), async (req: Request, res: Response) => {
    if (!req.file) throw new HTTPError("Missing file");
    const asset = ([req.params.path].flat() as string[]).join("/");
    if (!validAssetPath(asset) || asset.split("/").length < 2) throw new HTTPError("Invalid asset path");
    const { buffer, size } = req.file;
    const type = await fileTypeFromBuffer(buffer);
    if (!type || !UPLOAD_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");
    await storage.set(`collectibles-shop/${asset}`, buffer);
    return res.json({ id: asset, hash: crypto.createHash("md5").update(buffer).digest("hex"), content_type: type.mime, size });
});

router.delete("/*path", validateServerAuth, async (req: Request, res: Response) => {
    const asset = ([req.params.path].flat() as string[]).join("/");
    if (!validAssetPath(asset)) throw new HTTPError("Invalid asset path");
    if (await storage.exists(`collectibles-shop/${asset}`)) await storage.delete(`collectibles-shop/${asset}`);
    return res.json({ success: true });
});

export default router;
