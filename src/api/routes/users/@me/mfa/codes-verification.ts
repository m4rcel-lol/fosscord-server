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
import { ResponseError, freshBackupCodes, guardedMfaAttempt, readTicket, serializeBackupCodes } from "@spacebar/api/util";
import { BackupCode } from "@spacebar/database";
import { hashKey } from "../../../auth/verify/view-backup-codes-challenge";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            200: {
                body: "BackupCodeArray",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { key, nonce, regenerate } = req.body as { key?: string; nonce?: string; regenerate?: boolean };
        const decoded = readTicket<{ typ: string; uid?: string; kh?: string; regenerate?: boolean }>(nonce, "backup_codes");
        if (!decoded || decoded.uid !== req.user_id || !!decoded.regenerate !== !!regenerate) throw new ResponseError(400, { message: "Invalid nonce", code: 60011 });
        if (!(await guardedMfaAttempt(nonce!, async () => !!decoded.kh && typeof key === "string" && hashKey(key) === decoded.kh)))
            throw new ResponseError(400, { message: "Invalid verification key", code: 60011 });

        const codes = regenerate ? await freshBackupCodes(req.user_id) : await BackupCode.find({ where: { user: { id: req.user_id }, expired: false } });

        res.json({ backup_codes: serializeBackupCodes(req.user_id, codes) });
    },
);

export default router;
