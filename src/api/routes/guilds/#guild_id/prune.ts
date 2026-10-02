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
import { IsNull, LessThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Guild, Member } from "@spacebar/database";
import { AuditLogEvents } from "@spacebar/schemas";
import { Snowflake } from "@spacebar/util";

const router = Router({ mergeParams: true });

//Returns all inactive members, respecting role hierarchy
const inactiveMembers = async (guild_id: string, user_id: string, days: number, roles: string[] = []) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    //Snowflake should have `generateFromTime` method? Or similar?
    const minId = BigInt(date.valueOf() - Snowflake.EPOCH) << BigInt(22);

    /**
	idea: ability to customise the cutoff variable
	possible candidates: public read receipt, last presence, last VC leave
	**/
    let members = await Member.find({
        where: [
            {
                guild_id,
                last_message_id: LessThan(minId.toString()),
            },
            {
                guild_id,
                last_message_id: IsNull(),
            },
        ],
        relations: { roles: true },
    });
    if (!members.length) return [];

    members = members.filter((member) => new Date(member.joined_at) < date && member.roles.every((role) => role.id === guild_id || roles.includes(role.id)));

    const me = await Member.findOneOrFail({
        where: { id: user_id, guild_id },
        relations: { roles: true },
    });
    const myHighestRole = Math.max(...(me.roles?.map((x) => x.position) || []));

    const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

    members = members.filter(
        (member) =>
            member.id !== guild.owner_id && //can't kick owner
            (me.id === guild.owner_id || member.roles.every((role) => role.position < myHighestRole)),
    );

    return members;
};

router.get(
    "/",
    route({
        responses: {
            "200": {
                body: "GuildPruneResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const days = parseInt(req.query.days as string);

        let roles = req.query.include_roles ?? [];
        if (typeof roles === "string") roles = roles.split(",");

        const members = await inactiveMembers(req.params.guild_id as string, req.user_id, days, roles as string[]);

        res.send({ pruned: members.length });
    },
);

router.post(
    "/",
    route({
        permission: "KICK_MEMBERS",
        right: "KICK_BAN_MEMBERS",
        responses: {
            200: {
                body: "GuildPurgeResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const days = parseInt(req.body.days ?? req.query.days ?? 7);

        let roles = req.body.include_roles ?? req.query.include_roles ?? [];
        if (typeof roles === "string") roles = roles.split(",");

        const { guild_id } = req.params as { [key: string]: string };
        const members = await inactiveMembers(guild_id, req.user_id, days, roles as string[]);

        await Promise.all(members.map((x) => Member.removeFromGuild(x.id, guild_id)));
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.MEMBER_PRUNE,
            options: { delete_member_days: String(days), members_removed: String(members.length) },
            reason: req.headers["x-audit-log-reason"],
        });

        res.send({ pruned: req.body.compute_prune_count === false ? null : members.length });
    },
);

export default router;
