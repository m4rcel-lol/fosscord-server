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
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Badge, Guild, InstanceBan, Member, Session, User } from "@spacebar/database";
import { emitEvent, Rights, UserUpdateEvent } from "@spacebar/util";
import { AdminUserUpdateSchema, PrivateUserProjection } from "@spacebar/schemas";
import { In } from "typeorm";
import { ADMIN_USER_COLUMNS, applyUserTag, pickAdminUser } from "../index";

const router = Router({ mergeParams: true });

const loadUser = (id: string) =>
    User.findOneOrFail({
        where: { id },
        select: Object.fromEntries([...ADMIN_USER_COLUMNS, "bio", "premium_since"].map((c) => [c, true])),
    });

router.get(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        description: "Get a user with their servers, session count and instance bans",
    }),
    async (req: Request, res: Response) => {
        const user = await loadUser(req.params.user_id as string);

        const memberships = await Member.find({ where: { id: user.id }, select: { guild_id: true, joined_at: true } });
        const guilds = memberships.length
            ? await Guild.find({ where: { id: In(memberships.map((m) => m.guild_id)) }, select: { id: true, name: true, icon: true, owner_id: true } })
            : [];
        const [sessions, bans] = await Promise.all([Session.count({ where: { user_id: user.id } }), InstanceBan.find({ where: { user_id: user.id } })]);

        res.json({
            ...pickAdminUser(user),
            bio: user.bio,
            premium_since: user.premium_since ?? null,
            guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null, owner: g.owner_id === user.id })),
            session_count: sessions,
            instance_bans: bans.map((b) => ({ id: b.id, reason: b.reason, created_at: b.created_at })),
        });
    },
);

router.patch(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        requestBody: "AdminUserUpdateSchema",
        description: "Edit a user. Changing rights, or editing an operator, requires OPERATOR.",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminUserUpdateSchema;
        const user = await loadUser(req.params.user_id as string);
        const callerIsOperator = req.rights.has("OPERATOR");
        const targetIsOperator = new Rights(user.rights).has("OPERATOR");
        const isSelf = user.id === req.user_id;

        if (targetIsOperator && !callerIsOperator && !isSelf) throw new HTTPError("Only operators can edit other operators", 403);
        if (isSelf && body.disabled) throw new HTTPError("You can't disable your own account", 400);

        if (body.rights !== undefined) {
            if (!callerIsOperator) throw new HTTPError("Only operators can change rights", 403);
            if (!/^\d+$/.test(body.rights)) throw new HTTPError("rights must be a decimal bitfield string", 400);
            if (isSelf && !new Rights(body.rights).has("OPERATOR")) throw new HTTPError("You can't remove OPERATOR from yourself", 400);
            user.rights = body.rights;
        }

        if (body.hide_premium_badge !== undefined) user.hide_premium_badge = body.hide_premium_badge;
        if (body.tag !== undefined) applyUserTag(user, body.tag);
        if (body.badge_ids !== undefined) {
            const ids = [...new Set(body.badge_ids)];
            const known = ids.length ? await Badge.find({ where: { id: In(ids) }, select: { id: true } }) : [];
            const unknown = ids.filter((id) => !known.some((b) => b.id === id));
            if (unknown.length) throw new HTTPError(`Unknown badge: ${unknown.join(", ")}`, 400);
            user.badge_ids = ids;
        }
        if (body.global_name !== undefined) user.global_name = body.global_name?.trim() || null;
        if (body.bio !== undefined) user.bio = body.bio;
        if (body.disabled !== undefined) user.disabled = body.disabled;
        if (body.verified !== undefined) user.verified = body.verified;
        if (body.premium_type !== undefined) {
            if (body.premium_type > 0 && !user.premium_type) user.premium_since = new Date();
            user.premium_type = body.premium_type;
            user.premium = body.premium_type > 0;
        }

        await user.save();

        // a disabled account must not keep its live sessions
        if (body.disabled) await Session.delete({ user_id: user.id });

        const updated = await User.findOneOrFail({ where: { id: user.id }, select: Object.fromEntries(PrivateUserProjection.map((i) => [i, true])) });
        await emitEvent({ event: "USER_UPDATE", user_id: user.id, data: updated } satisfies UserUpdateEvent);

        res.json(pickAdminUser(await loadUser(user.id)));
    },
);

export default router;
