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
import { MfaInvalidCode, ResponseError, currentToken, emitUserUpdate, freshBackupCodes, requireMfa, serializeBackupCodes, verifyTotp } from "@spacebar/api/util";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            200: {
                body: "TokenWithBackupCodesResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { password, secret, code } = req.body as { password?: string; secret?: string; code?: string };

        const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, mfa_enabled: true, totp_secret: true } });
        if (user.mfa_enabled && user.totp_secret) throw new ResponseError(400, { message: "Two factor is already enabled.", code: 60001 });

        await requireMfa(req, { password });

        if (!secret || !/^[A-Z2-7]{16,64}$/i.test(secret)) throw new ResponseError(400, { message: "Invalid two-factor secret", code: 60005 });
        if (!verifyTotp(secret, code)) throw MfaInvalidCode();

        await User.update({ id: req.user_id }, { mfa_enabled: true, totp_secret: secret.toUpperCase() });
        const codes = await freshBackupCodes(req.user_id);
        await emitUserUpdate(req.user_id);

        res.json({
            token: currentToken(req),
            backup_codes: serializeBackupCodes(req.user_id, codes),
        });
    },
);

export default router;
