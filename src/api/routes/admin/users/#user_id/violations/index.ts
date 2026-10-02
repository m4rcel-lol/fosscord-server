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
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { User, UserViolation } from "@spacebar/database";
import { AdminViolationCreateSchema } from "@spacebar/schemas";
import { accountStanding, automaticAccountStanding, currentStanding, getUserViolations, isActiveViolation, notifyStandingDrop, notifyViolation } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// "permanent" violations still need an expiry for clients, so they get one far beyond anyone's account
const PERMANENT = new Date("2100-01-01T00:00:00Z");

export async function describeStanding(user_id: string) {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, disabled: true, account_standing: true } });
    const violations = await getUserViolations(user_id);
    const issuers = await User.find({
        where: { id: In([...new Set(violations.map((v) => v.issued_by).filter((id): id is string => !!id))]) },
        select: { id: true, username: true, global_name: true },
    });
    return {
        standing: { state: accountStanding(user, violations), override: user.account_standing ?? null, automatic: automaticAccountStanding(user, violations) },
        violations: violations.map((v) => {
            const issuer = issuers.find((u) => u.id === v.issued_by);
            return {
                id: v.id,
                classification_type: v.classification_type,
                description: v.description,
                actions: v.actions,
                created_at: v.created_at,
                expires_at: v.expires_at,
                permanent: v.expires_at >= PERMANENT,
                active: isActiveViolation(v),
                appeal_status: v.appeal_status ?? null,
                appealed_at: v.appealed_at ?? null,
                appeal_signal: v.appeal_signal ?? null,
                appeal_user_input: v.appeal_user_input ?? null,
                appeal_resolved_by: v.appeal_resolved_by ?? null,
                issued_by: issuer ? { id: issuer.id, username: issuer.username, global_name: issuer.global_name ?? null } : v.issued_by ? { id: v.issued_by } : null,
            };
        }),
    };
}

router.get("/", route({ right: "MANAGE_USERS", spacebarOnly: true, description: "A user's account standing and violations" }), async (req: Request, res: Response) => {
    res.json(await describeStanding(req.params.user_id as string));
});

router.post(
    "/",
    route({ right: "MANAGE_USERS", spacebarOnly: true, requestBody: "AdminViolationCreateSchema", description: "Add a violation to a user's account standing" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminViolationCreateSchema;
        const user_id = req.params.user_id as string;
        await User.findOneOrFail({ where: { id: user_id }, select: { id: true } });
        const before = await currentStanding(user_id);

        const violation = await UserViolation.create({
            user_id,
            classification_type: body.classification_type,
            description: body.description.trim(),
            actions: (body.actions ?? []).map((a) => ({ action_type: a.action_type, descriptions: (a.descriptions ?? []).map((d) => d.trim()).filter(Boolean) })),
            issued_by: req.user_id,
            expires_at: body.expires_in_days ? new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000) : PERMANENT,
        }).save();

        // the user hears about it from the official account, and again if it drops their standing
        await notifyViolation(violation);
        await notifyStandingDrop(user_id, before, await currentStanding(user_id), violation.id);

        res.status(201).json(await describeStanding(user_id));
    },
);

export default router;
