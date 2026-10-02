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

import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { PhoneVerification, emitUserUpdate, passwordMismatch } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

const checkPassword = async (user_id: string, password: unknown) => {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, data: true } });
    if (user.data?.hash && !(typeof password === "string" && (await bcrypt.compare(password, user.data.hash)))) throw passwordMismatch();
};

router.post("/", route({ responses: { 204: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { phone, phone_token, password } = req.body as { phone?: string; phone_token?: string; password?: string };

    if (phone !== undefined) {
        PhoneVerification.send(PhoneVerification.normalize(phone), req.user_id);
        return res.sendStatus(204);
    }

    const verified = PhoneVerification.readToken(phone_token, req.user_id);
    if (!verified) throw FieldErrors({ phone_token: { code: "PHONE_TOKEN_INVALID", message: "Invalid phone verification token" } });
    await checkPassword(req.user_id, password);

    const previous = await User.find({ where: { phone: verified, id: Not(req.user_id) }, select: { id: true } });
    await User.update({ id: req.user_id }, { phone: verified });
    for (const other of previous) {
        await User.update({ id: other.id }, { phone: null });
        await emitUserUpdate(other.id);
    }
    await emitUserUpdate(req.user_id);
    res.sendStatus(204);
});

router.delete("/", route({ responses: { 204: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    await checkPassword(req.user_id, (req.body as { password?: string })?.password);
    await User.update({ id: req.user_id }, { phone: null });
    await emitUserUpdate(req.user_id);
    res.sendStatus(204);
});

export default router;
