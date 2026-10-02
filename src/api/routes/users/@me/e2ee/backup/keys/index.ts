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
import { In, IsNull, Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { decodeKey, E2eeErrors, e2eeRateLimit } from "@spacebar/api/util";
import { E2eeBackupKey, E2eeKeyBackup, Message, Recipient } from "@spacebar/database";
import { E2eeBackupKeysUploadSchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    e2eeRateLimit("e2ee_backup_keys", 120, 60),
    route({
        spacebarOnly: true,
        requestBody: "E2eeBackupKeysUploadSchema",
        responses: { 204: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { keys } = req.body as E2eeBackupKeysUploadSchema;
        if (!Array.isArray(keys) || keys.length > 100) throw E2eeErrors.INVALID_BACKUP;
        const valid = keys.every(
            (k) =>
                typeof k.message_id === "string" &&
                /^\d{1,20}$/.test(k.message_id) &&
                !!decodeKey(k.enc, 32) &&
                typeof k.wrapped === "string" &&
                /^[A-Za-z0-9_-]{1,128}$/.test(k.wrapped),
        );
        if (!valid || new Set(keys.map((k) => k.message_id)).size !== keys.length) throw E2eeErrors.INVALID_BACKUP;
        if (!keys.length) return res.sendStatus(204);
        if (!(await E2eeKeyBackup.findOne({ where: { user_id: req.user_id }, select: { user_id: true } }))) throw E2eeErrors.NO_BACKUP;

        const messages = await Message.find({ where: { id: In(keys.map((k) => k.message_id)), encrypted: Not(IsNull()) }, select: { id: true, channel_id: true } });
        const channels = [...new Set(messages.map((m) => m.channel_id!))];
        const member = channels.length ? await Recipient.find({ where: { user_id: req.user_id, channel_id: In(channels) }, select: { channel_id: true } }) : [];
        const allowed = new Set(member.map((r) => r.channel_id));
        const known = new Set(messages.filter((m) => allowed.has(m.channel_id!)).map((m) => m.id));
        const rows = keys
            .filter((k) => known.has(k.message_id))
            .map((k) => ({ user_id: req.user_id, message_id: k.message_id, enc: k.enc, wrapped: k.wrapped, created_at: new Date() }));
        if (rows.length) await E2eeBackupKey.upsert(rows, ["user_id", "message_id"]);
        res.sendStatus(204);
    },
);

export default router;
