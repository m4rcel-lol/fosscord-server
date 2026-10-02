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
import {
    MfaInvalidTicket,
    ResponseError,
    creationOptions,
    emitUserEvent,
    emitUserUpdate,
    freshBackupCodes,
    readTicket,
    requestOrigin,
    requireMfa,
    serializeBackupCodes,
    signTicket,
    verifyAttestation,
} from "@spacebar/api/util";
import { SecurityKey, User } from "@spacebar/database";

export const serializeAuthenticator = (key: SecurityKey) => ({
    id: key.id,
    type: 1,
    name: key.name,
    last_used: null,
    cred_id: Buffer.from(key.key_id, "base64").toString("base64url"),
});

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const keys = await SecurityKey.find({ where: { user_id: req.user_id } });
    res.json(keys.map(serializeAuthenticator));
});

router.post("/", route({}), async (req: Request, res: Response) => {
    const { name, ticket, credential, password } = req.body as { name?: string; ticket?: string; credential?: string; password?: string };

    if (!ticket || !credential) {
        await requireMfa(req, { password });
        const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, username: true } });
        const origin = requestOrigin(req);
        const { challenge, options } = await creationOptions(origin, user);
        return res.json({ ticket: signTicket({ typ: "webauthn_create", uid: req.user_id, ch: challenge, origin }), challenge: options });
    }

    const decoded = readTicket(ticket, "webauthn_create");
    if (!decoded?.ch || !decoded.origin || decoded.uid !== req.user_id) throw MfaInvalidTicket();

    const trimmed = (name ?? "").trim();
    if (!trimmed || trimmed.length > 32)
        throw new ResponseError(400, {
            message: "Invalid Form Body",
            code: 50035,
            errors: { name: { _errors: [{ code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 1 and 32 in length." }] } },
        });

    const attestation = verifyAttestation(credential, decoded.ch, decoded.origin);
    if (!attestation) throw new ResponseError(400, { message: "Invalid security key", code: 50035 });

    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, mfa_enabled: true } });
    const firstAuthenticator = !user.mfa_enabled;

    const key = SecurityKey.create({ ...attestation, name: trimmed, user_id: req.user_id });
    await key.save();
    await User.update({ id: req.user_id }, { webauthn_enabled: true, mfa_enabled: true });

    const backup_codes = firstAuthenticator ? serializeBackupCodes(req.user_id, await freshBackupCodes(req.user_id)) : undefined;
    await emitUserUpdate(req.user_id);
    await emitUserEvent(req.user_id, "AUTHENTICATOR_CREATE", serializeAuthenticator(key));

    res.json({ ...serializeAuthenticator(key), backup_codes });
});

export default router;
