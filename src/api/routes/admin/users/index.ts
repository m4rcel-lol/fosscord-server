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
import { Brackets } from "typeorm";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Rights } from "@spacebar/util";
import { User } from "@spacebar/database";
import { AdminUserTag, UserFlags } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

export const ADMIN_USER_COLUMNS = [
    "id",
    "username",
    "discriminator",
    "global_name",
    "avatar",
    "email",
    "created_at",
    "disabled",
    "deleted",
    "verified",
    "premium_type",
    "rights",
    "bot",
    "flags",
    "public_flags",
    "badge_ids",
    "hide_premium_badge",
    "account_standing",
] as const;

// entities carry class-level defaults for every column, so only ever send the columns we selected
export const pickAdminUser = (user: User) => ({ ...Object.fromEntries(ADMIN_USER_COLUMNS.map((c) => [c, user[c] ?? null])), tag: userTag(user) });

export const assertCanManage = (req: Request, target: Pick<User, "id" | "rights">) => {
    if (target.id !== req.user_id && new Rights(target.rights).has("OPERATOR") && !req.rights.has("OPERATOR"))
        throw new HTTPError("Only operators can manage other operators", 403);
};

const TAG_FLAGS = { verified: Number(UserFlags.FLAGS.VERIFIED_BOT), ai: Number(UserFlags.FLAGS.AI_ACCOUNT) };

export const userTag = (user: Pick<User, "public_flags">): AdminUserTag => {
    const flags = Number(user.public_flags ?? 0);
    const verified = (flags & TAG_FLAGS.verified) !== 0;
    if (flags & TAG_FLAGS.ai) return verified ? "verified_ai" : "ai";
    return verified ? "verified_bot" : "none";
};

// public_flags is what other clients see; flags is what the user's own client sees, so both carry the tag
export const applyUserTag = (user: User, tag: AdminUserTag) => {
    const wanted = (tag === "verified_bot" || tag === "verified_ai" ? TAG_FLAGS.verified : 0) | (tag === "ai" || tag === "verified_ai" ? TAG_FLAGS.ai : 0);
    const mask = TAG_FLAGS.verified | TAG_FLAGS.ai;
    user.public_flags = (Number(user.public_flags ?? 0) & ~mask) | wanted;
    user.flags = Number((BigInt(user.flags ?? 0) & ~BigInt(mask)) | BigInt(wanted));
};

router.get(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        description: "Search users on this instance. `q` matches an exact id, or part of a username, display name or email.",
        query: {
            q: { type: "string", required: false },
            filter: { type: "string", required: false, description: "all | disabled | bots | verified | unverified" },
            limit: { type: "number", required: false },
            offset: { type: "number", required: false },
        },
    }),
    async (req: Request, res: Response) => {
        const q = String(req.query.q ?? "").trim();
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const query = User.createQueryBuilder("user")
            .select(ADMIN_USER_COLUMNS.map((c) => `user.${c}`))
            .orderBy("user.created_at", "DESC")
            .take(limit)
            .skip(offset);

        if (/^\d{15,20}$/.test(q)) query.where("user.id = :id", { id: q });
        else if (q)
            query.where(
                new Brackets((qb) =>
                    qb
                        .where("user.username ILIKE :q", { q: `%${q}%` })
                        .orWhere("user.global_name ILIKE :q", { q: `%${q}%` })
                        .orWhere("user.email ILIKE :q", { q: `%${q}%` }),
                ),
            );

        switch (req.query.filter) {
            case "disabled":
                query.andWhere("user.disabled = true");
                break;
            case "bots":
                query.andWhere("user.bot = true");
                break;
            case "verified":
                query.andWhere("user.verified = true");
                break;
            case "unverified":
                query.andWhere("user.verified = false");
                break;
            default: // "all"
                break;
        }

        const [users, total] = await query.getManyAndCount();
        res.json({ total, users: users.map(pickAdminUser) });
    },
);

export default router;
