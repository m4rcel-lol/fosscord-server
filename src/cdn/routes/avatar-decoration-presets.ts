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
import { fileTypeFromBuffer } from "file-type";
import { AvatarDecoration } from "@spacebar/database";
import { storage, setCacheControl, setCacheControlNotFound, fetchUpstreamAsset } from "../util";

const router = Router({ mergeParams: true });

router.get("/:avatar_decoration_data_asset", setCacheControl, async (req: Request, res: Response) => {
    const { avatar_decoration_data_asset } = req.params as { [key: string]: string };
    const path = `avatar-decoration-presets/${avatar_decoration_data_asset}`;

    const file = await storage.get(path);
    if (!file) {
        if (await tryReturnFromCollectiblesShop(req, res, avatar_decoration_data_asset)) return;
        const [asset] = avatar_decoration_data_asset.split(".");
        if (!/^(a_)?[0-9a-f]{32}$/.test(asset)) return setCacheControlNotFound(req, res);
        const passthrough = req.query.passthrough !== "false";
        const upstream = await fetchUpstreamAsset(
            `avatar-decoration-presets-upstream/${asset}${passthrough ? "" : "-static"}`,
            `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=240&passthrough=${passthrough}`,
        );
        if (!upstream) return setCacheControlNotFound(req, res);
        res.set("Content-Type", (await fileTypeFromBuffer(upstream))?.mime ?? "image/png");
        return res.send(upstream);
    }
    const type = await fileTypeFromBuffer(file);

    res.set("Content-Type", type?.mime);

    return res.send(file);
});

async function tryReturnFromCollectiblesShop(req: Request, res: Response, avatar_decoration_data_asset: string) {
    const coll = await AvatarDecoration.findOne({ where: { asset: avatar_decoration_data_asset } });
    if (!coll) return false;

    const basePath = `collectibles-shop/${coll.id}`;

    let file: Buffer<ArrayBufferLike> | null;
    if (await storage.exists(basePath + "/animated")) {
        file = await storage.get(basePath + "/animated");
    } else if (await storage.exists(basePath + "/static")) {
        file = await storage.get(basePath + "/static");
    } else return false;

    const type = await fileTypeFromBuffer(file!);

    res.set("Content-Type", type?.mime);

    res.send(file);
    return true;
}

export default router;
