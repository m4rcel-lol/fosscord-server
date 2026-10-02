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
import { decodeKey, e2eeBackupKeyMessage, E2eeErrors, e2eeRateLimit, verifyEd25519 } from "@spacebar/api/util";
import { E2eeIdentity, E2eeKeyBackup } from "@spacebar/database";
import { E2eeBackupKdf, E2eeBackupSchema, E2eeBackupSecretSchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const blob = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);

const inRange = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const checkSecret = (body: E2eeBackupSecretSchema, allowEmpty: boolean) => {
    const kdf = body.kdf as E2eeBackupKdf | undefined;
    const argon = body.mode === "password" && kdf?.name === "argon2id" && inRange(kdf.memory, 19456, 1048576) && inRange(kdf.iterations, 1, 10) && inRange(kdf.parallelism, 1, 4);
    const hkdf = body.mode === "recovery" && kdf?.name === "hkdf-sha256";
    if (!argon && !hkdf) throw E2eeErrors.INVALID_BACKUP;
    if (!decodeKey(body.salt, 16)) throw E2eeErrors.INVALID_BACKUP;
    if (body.wrapped_secret === null ? !allowEmpty : !blob(body.wrapped_secret, 128)) throw E2eeErrors.INVALID_BACKUP;
    if (!Number.isInteger(body.version) || body.version < 0) throw E2eeErrors.INVALID_BACKUP;
};

const save = async (userId: string, version: number, fields: Partial<E2eeKeyBackup>) => {
    const updated_at = new Date();
    if (version === 0) {
        try {
            await E2eeKeyBackup.insert({ ...fields, user_id: userId, version: 1, updated_at });
        } catch {
            throw E2eeErrors.BACKUP_CONFLICT;
        }
    } else {
        const result = await E2eeKeyBackup.update({ user_id: userId, version }, { ...fields, version: version + 1, updated_at });
        if (!result.affected) throw E2eeErrors.BACKUP_CONFLICT;
    }
    return (await E2eeKeyBackup.findOneOrFail({ where: { user_id: userId } })).toPublic();
};

router.get(
    "/",
    route({
        spacebarOnly: true,
        responses: { 200: { body: "E2eeBackupResponse" } },
    }),
    async (req: Request, res: Response) => {
        const backup = await E2eeKeyBackup.findOne({ where: { user_id: req.user_id } });
        res.json(backup?.toPublic() ?? null);
    },
);

router.put(
    "/",
    e2eeRateLimit("e2ee_backup", 10, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeBackupSchema",
        responses: { 200: { body: "E2eeBackupResponse" }, 400: { body: "APIErrorResponse" }, 409: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeBackupSchema;
        checkSecret(body, true);
        if (!blob(body.wrapped_identity, 512) || !blob(body.wrapped_backup_key, 512) || !decodeKey(body.backup_public_key, 32)) throw E2eeErrors.INVALID_BACKUP;
        const identity = await E2eeIdentity.findOne({ where: { user_id: req.user_id } });
        if (!identity) throw E2eeErrors.NO_IDENTITY;
        if (body.identity_key !== identity.public_key) throw E2eeErrors.INVALID_BACKUP;
        if (!verifyEd25519(identity.public_key, e2eeBackupKeyMessage(req.user_id, body.backup_public_key), body.backup_key_signature)) throw E2eeErrors.INVALID_SIGNATURE;
        const fields = {
            mode: body.mode,
            kdf: body.kdf,
            salt: body.salt,
            wrapped_secret: body.wrapped_secret,
            identity_key: body.identity_key,
            wrapped_identity: body.wrapped_identity,
            backup_public_key: body.backup_public_key,
            backup_key_signature: body.backup_key_signature,
            wrapped_backup_key: body.wrapped_backup_key,
        };
        res.json(await save(req.user_id, body.version, fields));
    },
);

router.patch(
    "/",
    e2eeRateLimit("e2ee_backup", 10, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeBackupSecretSchema",
        responses: { 200: { body: "E2eeBackupResponse" }, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" }, 409: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeBackupSecretSchema;
        checkSecret(body, false);
        if (!(await E2eeKeyBackup.findOne({ where: { user_id: req.user_id }, select: { user_id: true } }))) throw E2eeErrors.NO_BACKUP;
        res.json(await save(req.user_id, body.version, { mode: body.mode, kdf: body.kdf, salt: body.salt, wrapped_secret: body.wrapped_secret }));
    },
);

export default router;
