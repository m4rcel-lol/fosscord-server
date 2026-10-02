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
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { decodeKey, e2eeDeviceId, e2eeDeviceMessage, E2eeErrors, e2eePrekeyMessage, e2eeRateLimit, e2eeUserKeys, emitE2eeUserEvent, verifyEd25519 } from "@spacebar/api/util";
import { E2eeDevice, E2eeIdentity } from "@spacebar/database";
import { E2eeDeviceCreateSchema, E2eePrekeySchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const checkPrekey = (deviceId: string, signingKey: string, prekey: E2eePrekeySchema) => {
    if (!Number.isInteger(prekey.id) || prekey.id < 0 || !decodeKey(prekey.public_key, 32)) throw E2eeErrors.INVALID_SIGNATURE;
    if (!verifyEd25519(signingKey, e2eePrekeyMessage(deviceId, prekey.id, prekey.public_key), prekey.signature)) throw E2eeErrors.INVALID_SIGNATURE;
};

router.get(
    "/",
    route({
        spacebarOnly: true,
        responses: { 200: { body: "E2eeUserKeysResponse" } },
    }),
    async (req: Request, res: Response) => {
        res.json((await e2eeUserKeys([req.user_id]))[req.user_id]);
    },
);

router.post(
    "/",
    e2eeRateLimit("e2ee_devices", 10, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeDeviceCreateSchema",
        responses: { 200: { body: "E2eeDeviceResponse" }, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeDeviceCreateSchema;
        if (!decodeKey(body.signing_key, 32) || e2eeDeviceId(body.signing_key) !== body.device_id) throw E2eeErrors.INVALID_SIGNATURE;
        checkPrekey(body.device_id, body.signing_key, body.prekey);

        const identity = await E2eeIdentity.findOne({ where: { user_id: req.user_id } });
        if (!identity) throw E2eeErrors.NO_IDENTITY;
        const signed = !!body.identity_signature && verifyEd25519(identity.public_key, e2eeDeviceMessage(req.user_id, body.device_id, body.signing_key), body.identity_signature);
        if (body.identity_signature && !signed) throw E2eeErrors.INVALID_SIGNATURE;

        const existing = await E2eeDevice.findOne({ where: { id: body.device_id } });
        if (existing && (existing.user_id !== req.user_id || existing.status === "revoked")) throw E2eeErrors.UNKNOWN_DEVICE;

        const now = new Date();
        const device = existing ?? E2eeDevice.create({ id: body.device_id, user_id: req.user_id, signing_key: body.signing_key, created_at: now, revoked_at: null });
        device.identity_signature = signed ? body.identity_signature! : (existing?.identity_signature ?? null);
        device.status = device.identity_signature ? "active" : "pending";
        device.name = body.name?.slice(0, 64) ?? existing?.name ?? null;
        device.prekey_id = body.prekey.id;
        device.prekey_public = body.prekey.public_key;
        device.prekey_signature = body.prekey.signature;
        device.prekey_updated_at = now;
        device.session_id = req.session?.session_id ?? null;
        await device.save();
        await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        res.json(device.toPublic());
    },
);

router.put(
    "/:device_id/prekey",
    e2eeRateLimit("e2ee_prekey", 10, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eePrekeySchema",
        responses: { 200: { body: "E2eeDeviceResponse" }, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { device_id } = req.params as { [key: string]: string };
        const device = await E2eeDevice.findOne({ where: { id: device_id, user_id: req.user_id } });
        if (!device || device.status === "revoked") throw new HTTPError("Unknown device", 404);
        const prekey = req.body as E2eePrekeySchema;
        if (prekey.id <= device.prekey_id) throw E2eeErrors.INVALID_SIGNATURE;
        checkPrekey(device.id, device.signing_key, prekey);
        device.prekey_id = prekey.id;
        device.prekey_public = prekey.public_key;
        device.prekey_signature = prekey.signature;
        device.prekey_updated_at = new Date();
        await device.save();
        await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        res.json(device.toPublic());
    },
);

router.delete(
    "/:device_id",
    route({
        spacebarOnly: true,
        responses: { 204: {}, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { device_id } = req.params as { [key: string]: string };
        const device = await E2eeDevice.findOne({ where: { id: device_id, user_id: req.user_id } });
        if (!device) throw new HTTPError("Unknown device", 404);
        device.status = "revoked";
        device.revoked_at = new Date();
        await device.save();
        await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        res.sendStatus(204);
    },
);

export default router;
