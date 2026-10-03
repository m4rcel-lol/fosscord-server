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
import { In, Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { decodeKey, E2eeErrors, e2eeRateLimit, emitE2eeUserEvent, endE2eeDeviceSession, revokeE2eeDevices } from "@spacebar/api/util";
import { E2eeDevice } from "@spacebar/database";
import { E2eeLinkSchema } from "@spacebar/schemas";
import { emitEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

const STAGES = ["request", "offer", "reveal", "approve", "deny", "cancel", "invite"];
const APPROVER_STAGES = ["offer", "approve", "deny", "invite"];

router.post(
    "/",
    e2eeRateLimit("e2ee_link", 60, 60),
    route({
        spacebarOnly: true,
        requestBody: "E2eeLinkSchema",
        responses: { 204: {}, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeLinkSchema;
        if (!STAGES.includes(body.stage) || typeof body.request_id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(body.request_id)) throw E2eeErrors.INVALID_LINK;
        const needs = {
            request: () => !!decodeKey(body.commit!, 32),
            offer: () => !!body.to_device && !!decodeKey(body.public_key!, 32),
            reveal: () => !!body.to_device && !!decodeKey(body.public_key!, 32),
            approve: () => !!body.to_device && !!decodeKey(body.iv!, 12) && typeof body.ct === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(body.ct),
            deny: () => !!body.to_device,
            cancel: () => true,
            invite: () => !!body.to_device,
        }[body.stage];
        if (!needs()) throw E2eeErrors.INVALID_LINK;
        if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 64)) throw E2eeErrors.INVALID_LINK;

        const ids = [...new Set([body.device_id, body.to_device].filter((id): id is string => typeof id === "string"))];
        const devices = await E2eeDevice.find({ where: { id: In(ids), user_id: req.user_id, status: Not("revoked") } });
        if (devices.length !== ids.length) throw E2eeErrors.UNKNOWN_DEVICE;

        const sender = devices.find((d) => d.id === body.device_id)!;
        if (APPROVER_STAGES.includes(body.stage) && sender.status !== "active") throw E2eeErrors.UNKNOWN_DEVICE;
        const data = {
            request_id: body.request_id,
            stage: body.stage,
            device_id: body.device_id,
            to_device: body.to_device ?? null,
            name: body.stage === "request" ? (body.name ?? sender.name ?? null) : null,
            commit: body.commit ?? null,
            public_key: body.public_key ?? null,
            iv: body.iv ?? null,
            ct: body.ct ?? null,
        };
        await emitEvent({ event: body.stage === "request" ? "E2EE_LINK_REQUEST" : "E2EE_LINK_RESPONSE", user_id: req.user_id, data });
        const denied = body.stage === "deny" ? devices.find((d) => d.id === body.to_device && d.status === "pending") : undefined;
        if (denied) {
            await revokeE2eeDevices([denied]);
            await endE2eeDeviceSession(denied, req.session?.session_id, "E2EE login denied");
            await emitE2eeUserEvent("E2EE_DEVICES_UPDATE", req.user_id);
        }
        res.sendStatus(204);
    },
);

export default router;
