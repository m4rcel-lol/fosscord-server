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
import { Ban, Guild, Member } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, GuildMemberUpdateEvent, Snowflake } from "@spacebar/util";
import { ackJoinRequest, deleteJoinRequest, findJoinRequest, isApplyGuild, startJoinRequest, submitJoinRequest, UNKNOWN_JOIN_REQUEST } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const request = await findJoinRequest({ guild_id, user_id: req.user_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    res.json(request.toJSON("self"));
});

router.get("/cooldown", route({}), async (req: Request, res: Response) => {
    res.json({ cooldown: 0 });
});

router.put("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const body = req.body as { version?: string; form_fields?: unknown[] };
    const guild = await Guild.findOne({ where: { id: guild_id }, select: { id: true, features: true, member_verification: true } });
    if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;
    if (await Ban.exists({ where: { guild_id, user_id: req.user_id } })) throw DiscordApiErrors.USER_BANNED;

    if (isApplyGuild(guild.features)) return res.json((await submitJoinRequest(guild, req.user_id, body.form_fields)).toJSON("self"));

    const member = await Member.findOneOrFail({ where: { id: req.user_id, guild_id }, relations: { roles: true, user: true } });
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

router.post("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const existing = await findJoinRequest({ guild_id, user_id: req.user_id });
    if (!existing) throw UNKNOWN_JOIN_REQUEST;
    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, features: true } });
    await deleteJoinRequest(existing);
    if (!isApplyGuild(guild.features)) return res.sendStatus(204);
    res.json((await startJoinRequest(guild_id, req.user_id)).toJSON("self"));
});

router.post("/ack", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    await ackJoinRequest(guild_id, req.user_id);
    res.sendStatus(204);
});

router.delete("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const existing = await findJoinRequest({ guild_id, user_id: req.user_id });
    if (existing) await deleteJoinRequest(existing);
    res.sendStatus(204);
});

export default router;
