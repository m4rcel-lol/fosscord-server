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
import { ResponseError, emitUserEvent, emitUserUpdate, requireMfa } from "@spacebar/api/util";
import { BackupCode, SecurityKey, User } from "@spacebar/database";
import { serializeAuthenticator } from "../index";

const router = Router({ mergeParams: true });

const findKey = async (req: Request) => {
    const key = await SecurityKey.findOne({ where: { id: req.params.key_id as string, user_id: req.user_id } });
    if (!key) throw new ResponseError(404, { message: "Unknown authenticator", code: 10066 });
    return key;
};

router.patch("/", route({}), async (req: Request, res: Response) => {
    const key = await findKey(req);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 32)
        throw new ResponseError(400, {
            message: "Invalid Form Body",
            code: 50035,
            errors: { name: { _errors: [{ code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 1 and 32 in length." }] } },
        });
    key.name = name;
    await key.save();
    await emitUserEvent(req.user_id, "AUTHENTICATOR_UPDATE", serializeAuthenticator(key));
    res.json(serializeAuthenticator(key));
});

router.delete("/", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    const key = await findKey(req);
    await requireMfa(req);
    await key.remove();

    const keys = await SecurityKey.count({ where: { user_id: req.user_id } });
    if (!keys) {
        const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, totp_secret: true } });
        await User.update({ id: req.user_id }, { webauthn_enabled: false, mfa_enabled: !!user.totp_secret });
        if (!user.totp_secret) await BackupCode.update({ user: { id: req.user_id } }, { expired: true });
    }
    await emitUserUpdate(req.user_id);
    await emitUserEvent(req.user_id, "AUTHENTICATOR_DELETE", { ...serializeAuthenticator(key), id: req.params.key_id });
    res.sendStatus(204);
});

export default router;
