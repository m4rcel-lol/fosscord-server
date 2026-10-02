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
import { Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import {
    decodeKey,
    e2eeChannelIdsFor,
    e2eeDeviceMessage,
    E2eeErrors,
    e2eeRateLimit,
    e2eeRotationMessage,
    e2eeUserKeys,
    emitE2eeUserEvent,
    verifyEd25519,
} from "@spacebar/api/util";
import { E2eeDevice, E2eeIdentity } from "@spacebar/database";
import { E2eeIdentityUpdateSchema, E2eeStateResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const state = async (userId: string): Promise<E2eeStateResponse> => {
    const [users, channels] = await Promise.all([e2eeUserKeys([userId]), e2eeChannelIdsFor(userId)]);
    return { ...users[userId], channels };
};

router.get(
    "/",
    route({
        spacebarOnly: true,
        responses: { 200: { body: "E2eeStateResponse" } },
    }),
    async (req: Request, res: Response) => {
        res.json(await state(req.user_id));
    },
);

router.put(
    "/identity",
    e2eeRateLimit("e2ee_identity", 5, 60),
    route({
        spacebarOnly: true,
        requestBody: "E2eeIdentityUpdateSchema",
        responses: { 200: { body: "E2eeStateResponse" }, 400: { body: "APIErrorResponse" }, 409: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { public_key, previous_signature, devices: signatures } = req.body as E2eeIdentityUpdateSchema;
        if (!decodeKey(public_key, 32)) throw E2eeErrors.INVALID_SIGNATURE;
        if ((signatures?.length ?? 0) > 64) throw E2eeErrors.INVALID_SIGNATURE;
        const existing = await E2eeIdentity.findOne({ where: { user_id: req.user_id } });
        if (!existing) {
            await E2eeIdentity.create({ user_id: req.user_id, public_key, previous_key: null, rotation_signature: null, created_at: new Date() }).save();
            await emitE2eeUserEvent("E2EE_IDENTITY_UPDATE", req.user_id);
        } else if (existing.public_key !== public_key) {
            if (!previous_signature || !verifyEd25519(existing.public_key, e2eeRotationMessage(req.user_id, existing.public_key, public_key), previous_signature))
                throw E2eeErrors.IDENTITY_EXISTS;
            const devices = await E2eeDevice.find({ where: { user_id: req.user_id, status: Not("revoked") } });
            for (const device of devices) {
                const signature = signatures?.find((s) => s.device_id === device.id)?.identity_signature;
                const valid = !!signature && verifyEd25519(public_key, e2eeDeviceMessage(req.user_id, device.id, device.signing_key), signature);
                device.identity_signature = valid ? signature! : null;
                device.status = valid ? "active" : "pending";
            }
            await E2eeIdentity.update({ user_id: req.user_id }, { public_key, previous_key: existing.public_key, rotation_signature: previous_signature, created_at: new Date() });
            if (devices.length) await E2eeDevice.save(devices);
            await emitE2eeUserEvent("E2EE_IDENTITY_UPDATE", req.user_id);
            await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        }
        res.json(await state(req.user_id));
    },
);

export default router;
