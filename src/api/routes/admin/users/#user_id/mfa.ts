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
import { emitUserUpdate, setSmsFlag } from "@spacebar/api/util";
import { BackupCode, SecurityKey, User } from "@spacebar/database";
import { assertCanManage } from "../index";

const router = Router({ mergeParams: true });

router.get("/", route({ right: "MANAGE_USERS", spacebarOnly: true, description: "Which two-factor methods a user has set up" }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({ where: { id: req.params.user_id as string }, select: { id: true, mfa_enabled: true, totp_secret: true, flags: true } });
    const [securityKeys, backupCodes] = await Promise.all([
        SecurityKey.count({ where: { user_id: user.id } }),
        BackupCode.count({ where: { user: { id: user.id }, expired: false, consumed: false } }),
    ]);
    res.json({ mfa_enabled: user.mfa_enabled, totp: !!user.totp_secret, security_keys: securityKeys, backup_codes: backupCodes });
});

router.delete(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        description: "Turn off two-factor for a user: removes their authenticator app, security keys, SMS and backup codes",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const user = await User.findOneOrFail({ where: { id: req.params.user_id as string }, select: { id: true, rights: true } });
        assertCanManage(req, user);

        await SecurityKey.delete({ user_id: user.id });
        await BackupCode.update({ user: { id: user.id } }, { expired: true });
        await User.update({ id: user.id }, { mfa_enabled: false, totp_secret: "", webauthn_enabled: false });
        await setSmsFlag(user.id, false);
        await emitUserUpdate(user.id);

        console.log(`[Admin] User ${req.user_id} reset two-factor for ${user.id}`);
        res.sendStatus(204);
    },
);

export default router;
