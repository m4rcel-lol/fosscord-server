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
import { checkCaptcha } from "@spacebar/api/util";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { Config, Email, FieldErrors } from "@spacebar/util";
import { ForgotPasswordSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "ForgotPasswordSchema",
        responses: {
            200: {},
            400: {
                body: "APIErrorOrCaptchaResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { login, captcha_key } = req.body as ForgotPasswordSchema;

        if (!login?.trim()) throw FieldErrors({ login: { code: "BASE_TYPE_REQUIRED", message: req.t("common:field.BASE_TYPE_REQUIRED") } });

        const config = Config.get();

        const captcha = await checkCaptcha(config.passwordReset.requireCaptcha, captcha_key, req.ip);
        if (captcha) return res.status(400).json(captcha);

        const user = await User.findOne({
            where: User.loginWhere(login),
            select: { username: true, discriminator: true, id: true, email: true, deleted: true },
        });

        if (!user?.email || user.deleted)
            throw FieldErrors({
                login: {
                    code: "EMAIL_DOES_NOT_EXIST",
                    message: "Email does not exist.",
                },
            });

        res.json({ method: "password_reset" });

        Email.sendResetPassword(user, user.email).catch((e) => {
            console.error(`Failed to send password reset email to ${user.tag} (${user.id}): ${e}`);
        });
    },
);

export default router;
