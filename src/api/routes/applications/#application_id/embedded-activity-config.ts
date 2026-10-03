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
import { route } from "@spacebar/api/middlewares";
import { ownedEmbeddedActivity } from "@spacebar/api/activities";
import { activityConfig } from "@spacebar/api/util/handlers/Application";
import { FieldErrors } from "@spacebar/util";
import { EmbeddedActivityConfigModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });
const PLATFORMS = ["web", "android", "ios"];

router.get("/", route({ responses: { 200: {}, 403: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    res.json(activityConfig(await ownedEmbeddedActivity(req.params.application_id as string, req.user_id)));
});

router.patch(
    "/",
    route({
        requestBody: "EmbeddedActivityConfigModifySchema",
        responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as EmbeddedActivityConfigModifySchema;
        const activity = await ownedEmbeddedActivity(req.params.application_id as string, req.user_id);
        const config = { ...activity.config };
        if (body.supported_platforms !== undefined) {
            const platforms = [...new Set(body.supported_platforms ?? ["web"])];
            if (!platforms.length || platforms.some((platform) => !PLATFORMS.includes(platform)))
                throw FieldErrors({ supported_platforms: { code: "BASE_TYPE_CHOICES", message: `Pick from ${PLATFORMS.join(", ")}.` } });
            config.supported_platforms = platforms;
        }
        for (const key of ["default_orientation_lock_state", "tablet_default_orientation_lock_state"] as const) {
            if (body[key] === undefined) continue;
            if (![1, 2, 3].includes(body[key]!)) throw FieldErrors({ [key]: { code: "BASE_TYPE_CHOICES", message: "Pick 1 (unlocked), 2 (portrait) or 3 (landscape)." } });
            config[key] = body[key];
        }
        if (body.requires_age_gate !== undefined) config.requires_age_gate = body.requires_age_gate;
        if (body.activity_preview_video_asset_id !== undefined) config.activity_preview_video_asset_id = body.activity_preview_video_asset_id;
        activity.config = config;
        await activity.save();
        res.json(activityConfig(activity));
    },
);

export default router;
