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

import bcrypt from "bcrypt";
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
    passwordMismatch,
    pruneE2eeDevices,
    revokeE2eeDevices,
    verifyEd25519,
    withE2eeSessions,
} from "@spacebar/api/util";
import { E2eeBackupKey, E2eeDevice, E2eeIdentity, E2eeKeyBackup, User } from "@spacebar/database";
import { E2eeIdentityUpdateSchema, E2eePasswordSchema, E2eeResetSchema, E2eeStateResponse } from "@spacebar/schemas";

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
        const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : null;
        const sessionId = req.session?.session_id;
        if (deviceId && sessionId) await E2eeDevice.update({ id: deviceId, user_id: req.user_id, status: Not("revoked") }, { session_id: sessionId });
        if (await pruneE2eeDevices(req.user_id)) await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        const current = await state(req.user_id);
        res.json({ ...current, devices: await withE2eeSessions(req.user_id, current.devices) });
    },
);

const checkPassword = async (userId: string, password: unknown) => {
    const user = await User.findOneOrFail({ where: { id: userId }, select: { id: true, data: true } });
    if (typeof password !== "string" || !user.data?.hash || !(await bcrypt.compare(password, user.data.hash))) throw passwordMismatch();
};

router.post(
    "/password",
    e2eeRateLimit("e2ee_password", 10, 600),
    route({
        spacebarOnly: true,
        requestBody: "E2eePasswordSchema",
        responses: { 204: {}, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        await checkPassword(req.user_id, (req.body as E2eePasswordSchema).password);
        res.sendStatus(204);
    },
);

router.post(
    "/reset",
    e2eeRateLimit("e2ee_reset", 5, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeResetSchema",
        responses: { 200: { body: "E2eeStateResponse" }, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { password, public_key } = req.body as E2eeResetSchema;
        await checkPassword(req.user_id, password);
        if (!decodeKey(public_key, 32)) throw E2eeErrors.INVALID_SIGNATURE;
        await revokeE2eeDevices(await E2eeDevice.find({ where: { user_id: req.user_id, status: Not("revoked") } }));
        await E2eeBackupKey.delete({ user_id: req.user_id });
        await E2eeKeyBackup.delete({ user_id: req.user_id });
        await E2eeIdentity.delete({ user_id: req.user_id });
        await E2eeIdentity.create({ user_id: req.user_id, public_key, previous_key: null, rotation_signature: null, created_at: new Date() }).save();
        await emitE2eeUserEvent("E2EE_IDENTITY_UPDATE", req.user_id);
        await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
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
            await E2eeIdentity.update({ user_id: req.user_id }, { public_key, previous_key: existing.public_key, rotation_signature: previous_signature });
            if (devices.length) await E2eeDevice.save(devices);
            await emitE2eeUserEvent("E2EE_IDENTITY_UPDATE", req.user_id);
            await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        }
        res.json(await state(req.user_id));
    },
);

export default router;
