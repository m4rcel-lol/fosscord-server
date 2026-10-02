/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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
import { Guild } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

const MAX_PAUSE = 24 * 60 * 60 * 1000;

router.put(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            200: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = (req.body ?? {}) as { invites_disabled_until?: string | null; dms_disabled_until?: string | null; lockdown_duration_hours?: number | null };

        const parse = (key: "invites_disabled_until" | "dms_disabled_until") => {
            const value = body[key];
            if (value == null) return null;
            const time = new Date(value).getTime();
            if (Number.isNaN(time) || time > Date.now() + MAX_PAUSE + 60_000)
                throw FieldErrors({ [key]: { code: "BASE_TYPE_BAD_DATETIME", message: "Pauses can last at most 24 hours." } });
            return time <= Date.now() ? null : new Date(time).toISOString();
        };

        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        const invites_disabled_until = parse("invites_disabled_until");
        const dms_disabled_until = parse("dms_disabled_until");
        guild.incidents_data = {
            ...(guild.incidents_data ?? { dm_spam_detected_at: null, raid_detected_at: null }),
            invites_disabled_until,
            dms_disabled_until,
            lockdown_duration_hours: invites_disabled_until || dms_disabled_until ? (body.lockdown_duration_hours ?? null) : null,
        };
        await guild.save();
        await Guild.emitUpdate(guild_id);

        return res.json(guild.incidents_data);
    },
);

export default router;
