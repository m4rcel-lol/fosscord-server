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
import { UserViolation } from "@spacebar/database";
import { AdminViolationUpdateSchema, AppealStatusValue } from "@spacebar/schemas";
import { resolveAppeal } from "@spacebar/api/util";
import { describeStanding } from "./index";

const router = Router({ mergeParams: true });

const findViolation = (req: Request) => UserViolation.findOneOrFail({ where: { id: req.params.violation_id as string, user_id: req.params.user_id as string } });

router.patch(
    "/",
    route({ right: "MANAGE_USERS", spacebarOnly: true, requestBody: "AdminViolationUpdateSchema", description: "Resolve an appeal on a violation or change when it expires" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminViolationUpdateSchema;
        const violation = await findViolation(req);
        // deciding a pending appeal tells the user and updates the staff reviews; anything else just records it
        if (body.appeal_status != null && (await resolveAppeal(violation, body.appeal_status === AppealStatusValue.CLASSIFICATION_INVALIDATED, req.user_id))) {
            /* resolved and saved */
        } else if (body.appeal_status !== undefined) violation.appeal_status = body.appeal_status;
        if (body.expires_at !== undefined) {
            const expires = new Date(body.expires_at);
            if (isNaN(expires.getTime())) throw new HTTPError("expires_at must be an ISO timestamp", 400);
            violation.expires_at = expires;
        }
        await violation.save();
        res.json(await describeStanding(violation.user_id));
    },
);

router.delete("/", route({ right: "MANAGE_USERS", spacebarOnly: true, description: "Remove a violation entirely" }), async (req: Request, res: Response) => {
    const violation = await findViolation(req);
    await UserViolation.delete({ id: violation.id });
    res.json(await describeStanding(violation.user_id));
});

export default router;
