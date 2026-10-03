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

import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Application, EmbeddedActivity } from "@spacebar/database";
import { DiscordApiErrors, FieldErrors, deleteFile, handleFile } from "@spacebar/util";
import { ApplicationAssetCreateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });
const MAX_ASSETS = 300;

const ownedApplication = async (req: Request) => {
    const app = await Application.findOne({ where: { id: req.params.application_id as string } });
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (app.owner_id !== req.user_id) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
    return app;
};

router.get("/", route({}), async (req: Request, res: Response) => {
    const app = await Application.findOne({ where: { id: req.params.application_id as string }, select: { id: true, assets: true } });
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const activity = await EmbeddedActivity.findOne({ where: { application_id: app.id }, select: { application_id: true, assets: true } });
    res.json([...(app.assets ?? []), ...(activity?.assets ?? [])]);
});

router.post(
    "/",
    route({
        requestBody: "ApplicationAssetCreateSchema",
        responses: { 201: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as ApplicationAssetCreateSchema;
        const app = await ownedApplication(req);
        const name = body.name.trim().toLowerCase();
        const assets = app.assets ?? [];
        if (!name) throw FieldErrors({ name: { code: "BASE_TYPE_REQUIRED", message: req.t("common:field.BASE_TYPE_REQUIRED") } });
        if (assets.length >= MAX_ASSETS) throw FieldErrors({ image: { code: "MAX_ASSETS", message: `Applications can have up to ${MAX_ASSETS} assets.` } });
        if (assets.some((asset) => asset.name === name)) throw FieldErrors({ name: { code: "ASSET_NAME_TAKEN", message: "An asset with this name already exists." } });
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(body.image))
            throw FieldErrors({ image: { code: "IMAGE_INVALID", message: "Upload a PNG, JPEG, GIF or WebP image." } });
        const id = await handleFile(`/app-assets/${app.id}`, body.image);
        if (!id) throw FieldErrors({ image: { code: "IMAGE_INVALID", message: "Upload a PNG, JPEG, GIF or WebP image." } });
        if (assets.some((asset) => asset.id === id)) throw FieldErrors({ image: { code: "ASSET_IMAGE_TAKEN", message: "This image is already uploaded as another asset." } });
        const asset = { id, name, type: body.type === 2 ? 2 : 1 };
        await Application.update({ id: app.id }, { assets: [...assets, asset] });
        res.status(201).json(asset);
    },
);

router.delete("/:asset_id", route({ responses: { 204: {}, 403: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const app = await ownedApplication(req);
    const assets = app.assets ?? [];
    const asset = assets.find((entry) => entry.id === req.params.asset_id);
    if (!asset) throw new HTTPError("Unknown asset", 404);
    await Application.update({ id: app.id }, { assets: assets.filter((entry) => entry !== asset) });
    await deleteFile(`/app-assets/${app.id}/${asset.id}`).catch(() => null);
    res.sendStatus(204);
});

export default router;
