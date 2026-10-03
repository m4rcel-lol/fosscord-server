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
import { BulkBanSchema } from "@spacebar/schemas";
import { Config, DiscordApiErrors, FieldErrors } from "@spacebar/util";
import { banDeleteSeconds, bannableUsers, banUsers } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "BulkBanSchema",
        permission: ["BAN_MEMBERS", "MANAGE_GUILD"],
        responses: {
            200: {
                body: "Ban",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = (req.body ?? {}) as BulkBanSchema;
        const userIds = Array.isArray(body.user_ids) ? [...new Set(body.user_ids.map(String))] : null;
        const max = Config.get().limits.guild.maxBulkBanUsers;
        if (!userIds?.length || userIds.length > max) throw FieldErrors({ user_ids: { code: "BASE_TYPE_BAD_LENGTH", message: `Must be between 1 and ${max} in length.` } });
        const delete_message_seconds = banDeleteSeconds(body);
        const headerReason = req.headers["x-audit-log-reason"];
        const reason = Array.isArray(headerReason) ? headerReason[0] : headerReason;
        const valid = userIds.filter((user_id) => /^\d{1,20}$/.test(user_id));
        const allowed = await bannableUsers(guild_id, req.user_id, valid);
        const { banned } = await banUsers({
            guild_id,
            user_ids: allowed,
            executor_id: req.user_id,
            reason: reason ? decodeURIComponent(reason) : undefined,
            delete_message_seconds,
        });
        const banned_users = userIds.filter((user_id) => banned.includes(user_id));
        const failed_users = userIds.filter((user_id) => !banned.includes(user_id));

        if (!banned_users.length) throw DiscordApiErrors.BULK_BAN_FAILED;
        return res.json({ banned_users, failed_users });
    },
);

export default router;
