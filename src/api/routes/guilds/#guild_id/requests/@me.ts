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
import { Guild, Member } from "@spacebar/database";
import { emitEvent, GuildMemberUpdateEvent, Snowflake } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.status(404).json({ message: "Unknown Guild Join Request", code: 10070 });
});

router.put("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const body = req.body as { version?: string; form_fields?: unknown[] };
    const [guild, member] = await Promise.all([
        Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, member_verification: true } }),
        Member.findOneOrFail({ where: { id: req.user_id, guild_id }, relations: { roles: true, user: true } }),
    ]);

    member.pending = false;
    await member.save();

    await emitEvent({
        event: "GUILD_MEMBER_UPDATE",
        guild_id,
        data: { ...member.toPublicMember(), guild_id, user: member.user.toPublicUser(), roles: member.roles.map((role) => role.id).filter((id) => id !== guild_id) },
    } satisfies GuildMemberUpdateEvent);

    const id = Snowflake.generate();
    res.json({
        id,
        join_request_id: id,
        created_at: new Date().toISOString(),
        application_status: "APPROVED",
        guild_id,
        form_responses: body.form_fields ?? guild.member_verification?.form_fields ?? [],
        last_seen: null,
        actioned_at: new Date().toISOString(),
        actioned_by_user: null,
        rejection_reason: null,
        user_id: req.user_id,
        user: member.user.toPublicUser(),
        interview_channel_id: null,
    });
});

router.delete("/", route({}), async (req: Request, res: Response) => {
    res.sendStatus(204);
});

export default router;
