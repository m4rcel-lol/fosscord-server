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

import { Router, Request, Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member, Role } from "@spacebar/database";
import { In } from "typeorm";
import { DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.patch("/", route({ permission: "MANAGE_ROLES" }), async (req: Request, res: Response) => {
    const { guild_id, role_id } = req.params as { [key: string]: string };
    const member_ids = ((req.body?.member_ids as string[]) ?? []).slice(0, 30);

    if (role_id == guild_id) throw DiscordApiErrors.INVALID_ROLE;
    await Role.findOneOrFail({ where: { id: role_id, guild_id } });

    const members = member_ids.length ? await Member.find({ where: { guild_id, id: In(member_ids) }, relations: { roles: true } }) : [];
    const add = members.filter((member) => !member.roles.some((role) => role.id === role_id));
    for (const member of add) await Member.addRole(member.id, guild_id, role_id);

    const updated = members.length ? await Member.find({ where: { guild_id, id: In(members.map((m) => m.id)) }, relations: { roles: true, user: true } }) : [];
    res.json(
        Object.fromEntries(
            updated.map((m) => [
                m.id,
                {
                    ...m.toPublicMember(),
                    user: m.user.toPublicUser(),
                    roles: m.roles.map((x) => x.id).filter((id) => id !== guild_id),
                },
            ]),
        ),
    );
});

export default router;
