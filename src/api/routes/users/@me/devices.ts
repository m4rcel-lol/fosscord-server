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

import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { PushDevice } from "@spacebar/database";
import { FieldErrors, isPublicUrl } from "@spacebar/util";
import { PushDeviceSchema } from "@spacebar/schemas";
import { vapidPublicKey } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const MAX_DEVICES = 20;

const invalid = (message: string) => FieldErrors({ token: { code: "BASE_TYPE_INVALID", message } });

async function parseWebPushToken(token: string) {
    let subscription: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    try {
        subscription = JSON.parse(token);
    } catch {
        throw invalid("Expected a JSON push subscription.");
    }
    const { endpoint, keys } = subscription ?? {};
    if (typeof endpoint !== "string" || endpoint.length > 2048 || !(await isPublicUrl(endpoint, { httpsOnly: true })))
        throw invalid("The push endpoint must be a public https URL.");
    if (typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") throw invalid("The push subscription has no keys.");
    const p256dh = Buffer.from(keys.p256dh, "base64url");
    const auth = Buffer.from(keys.auth, "base64url");
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw invalid("The push subscription keys are malformed.");
    return { endpoint, keys: { p256dh: p256dh.toString("base64url"), auth: auth.toString("base64url") } };
}

router.get(
    "/web-push",
    route({
        responses: {
            200: {},
        },
    }),
    (req: Request, res: Response) => {
        const public_key = vapidPublicKey();
        res.json({ enabled: !!public_key, public_key });
    },
);

router.post(
    "/",
    route({
        requestBody: "PushDeviceSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as PushDeviceSchema;
        const provider = body.provider.toLowerCase();
        if (provider === "webpush" && !vapidPublicKey()) throw invalid("Web push is disabled on this instance.");
        const subscription = provider === "webpush" ? await parseWebPushToken(body.token) : null;
        const token = subscription?.endpoint ?? body.token;

        await PushDevice.delete({ provider, token });
        await PushDevice.create({
            user_id: req.user_id,
            session_id: req.session?.session_id ?? null,
            provider,
            token,
            keys: subscription?.keys ?? null,
            voip_provider: body.voip_provider ?? null,
            voip_token: body.voip_token ?? null,
        }).save();

        const stale = await PushDevice.find({ where: { user_id: req.user_id }, order: { created_at: "DESC" }, skip: MAX_DEVICES, select: { id: true } });
        if (stale.length) await PushDevice.delete(stale.map((device) => device.id));

        res.sendStatus(204);
    },
);

export default router;
