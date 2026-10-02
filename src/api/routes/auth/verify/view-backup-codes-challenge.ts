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

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { signTicket } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { Config, Email, FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

export const hashKey = (key: string) => crypto.createHash("sha256").update(key.trim().toLowerCase()).digest("base64url");

router.post(
    "/",
    route({
        responses: {
            200: { body: "BackupCodesChallengeResponse" },
            400: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { password } = req.body as { password?: string };

        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { id: true, username: true, email: true, data: true },
        });

        if (!password || !(await bcrypt.compare(password, user.data.hash || "")))
            throw FieldErrors({
                password: {
                    message: req.t("auth:login.INVALID_PASSWORD"),
                    code: "INVALID_PASSWORD",
                },
            });

        let kh: string | undefined;
        if (Email.transporter && user.email) {
            const key = crypto.randomBytes(4).toString("hex");
            kh = hashKey(key);
            const { instanceName } = Config.get().general;
            await Email.transporter.sendMail({
                from: Config.get().email.senderAddress || Config.get().general.correspondenceEmail || "noreply@localhost",
                to: user.email,
                subject: `Your ${instanceName} backup codes verification key`,
                text: `Hey ${user.username},\n\nUse this key to view or regenerate your backup codes: ${key}\n\nThis key expires in 30 minutes.`,
                html: `<p>Hey ${user.username},</p><p>Use this key to view or regenerate your backup codes:</p><p style="font-size:24px;font-weight:bold;letter-spacing:2px">${key}</p><p>This key expires in 30 minutes.</p>`,
            });
        }

        res.json({
            nonce: signTicket({ typ: "backup_codes", uid: user.id, kh, regenerate: false, n: crypto.randomUUID() }, 1800),
            regenerate_nonce: signTicket({ typ: "backup_codes", uid: user.id, kh, regenerate: true, n: crypto.randomUUID() }, 1800),
        });
    },
);

export default router;
