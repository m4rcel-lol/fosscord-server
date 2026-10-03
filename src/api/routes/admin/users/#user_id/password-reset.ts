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
import { revokeSessions } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { Email, MailTypes } from "@spacebar/util";
import { AdminPasswordResetSchema } from "@spacebar/schemas";
import { assertCanManage } from "../index";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        requestBody: "AdminPasswordResetSchema",
        description: "Make a one hour password reset link for a user, optionally emailing it and signing them out everywhere",
    }),
    async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as AdminPasswordResetSchema;
        const user = await User.findOneOrFail({
            where: { id: req.params.user_id as string },
            select: { id: true, username: true, discriminator: true, email: true, rights: true, bot: true, data: true },
        });
        assertCanManage(req, user);

        const link = await Email.generateLink(MailTypes.resetPassword, user.id);
        const emailed = !!(body.send_email && user.email && Email.transporter);
        if (emailed) await Email.sendResetPassword(user, user.email!);
        if (body.revoke_sessions) {
            await User.update({ id: user.id }, { data: { ...user.data, valid_tokens_since: new Date() } });
            await revokeSessions(user.id);
        }

        console.log(`[Admin] User ${req.user_id} made a password reset link for ${user.id}`);
        res.json({ link, expires_in: 3600, emailed, email_available: !!(user.email && Email.transporter) });
    },
);

export default router;
