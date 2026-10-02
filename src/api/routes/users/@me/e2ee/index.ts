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
import { route } from "@spacebar/api/middlewares";
import { e2eeChannelIdsFor, E2eeErrors, e2eeRateLimit, emitE2eeUserEvent, decodeKey } from "@spacebar/api/util";
import { E2eeDevice, E2eeIdentity } from "@spacebar/database";
import { E2eeIdentityUpdateSchema, E2eeStateResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        responses: { 200: { body: "E2eeStateResponse" } },
    }),
    async (req: Request, res: Response) => {
        const [identity, devices, channels] = await Promise.all([
            E2eeIdentity.findOne({ where: { user_id: req.user_id } }),
            E2eeDevice.find({ where: { user_id: req.user_id }, order: { created_at: "ASC" } }),
            e2eeChannelIdsFor(req.user_id),
        ]);
        res.json({ identity_key: identity?.public_key ?? null, devices: devices.map((d) => d.toPublic()), channels } satisfies E2eeStateResponse);
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
        const { public_key } = req.body as E2eeIdentityUpdateSchema;
        if (!decodeKey(public_key, 32)) throw E2eeErrors.INVALID_SIGNATURE;
        const existing = await E2eeIdentity.findOne({ where: { user_id: req.user_id } });
        if (existing && existing.public_key !== public_key) throw E2eeErrors.IDENTITY_EXISTS;
        if (!existing) {
            await E2eeIdentity.create({ user_id: req.user_id, public_key, created_at: new Date() }).save();
            await emitE2eeUserEvent("E2EE_IDENTITY_UPDATE", req.user_id);
        }
        const [devices, channels] = await Promise.all([E2eeDevice.find({ where: { user_id: req.user_id } }), e2eeChannelIdsFor(req.user_id)]);
        res.json({ identity_key: public_key, devices: devices.map((d) => d.toPublic()), channels } satisfies E2eeStateResponse);
    },
);

export default router;
