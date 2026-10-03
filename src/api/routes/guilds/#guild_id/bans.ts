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
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Ban, User } from "@spacebar/database";
import { DiscordApiErrors, FieldErrors, GuildBanRemoveEvent, emitEvent } from "@spacebar/util";
import { banDeleteSeconds, banHierarchy, banUser } from "@spacebar/api/util";
import { AuditLogEvents, BanCreateSchema, BanRegistrySchema, GuildBanResponse, GuildBansResponse, PublicUser } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

/* TODO: Deleting the secrets is just a temporary go-around. Views should be implemented for both safety and better handling. */

router.get(
    "/",
    route({
        permission: "BAN_MEMBERS",
        query: {
            limit: {
                type: "number",
                description: "Max number of bans to return (1-1000, default 1000)",
            },
            before: {
                type: "string",
                description: "Get bans before this user ID",
            },
            after: {
                type: "string",
                description: "Get bans after this user ID",
            },
        },
        responses: {
            200: {
                body: "GuildBansResponse",
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
        const limit = req.query.limit === undefined ? 1000 : Number(req.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw FieldErrors({ limit: { code: "NUMBER_TYPE_MAX", message: "Must be between 1 and 1000." } });
        const before = typeof req.query.before === "string" && /^\d{1,20}$/.test(req.query.before) ? req.query.before : undefined;
        const after = typeof req.query.after === "string" && /^\d{1,20}$/.test(req.query.after) ? req.query.after : undefined;

        const query = Ban.createQueryBuilder("ban")
            .innerJoin("ban.user", "user")
            .select(["ban.id", "ban.user_id", "ban.reason", ...["id", "username", "discriminator", "global_name", "avatar", "public_flags"].map((column) => `user.${column}`)])
            .where("ban.guild_id = :guild_id", { guild_id })
            .andWhere("ban.user_id IS DISTINCT FROM ban.executor_id")
            .limit(limit);
        if (after) query.andWhere("ban.user_id > :after", { after });
        if (before && !after) query.andWhere("ban.user_id < :before", { before });
        const bans = await query.orderBy("ban.user_id", before && !after ? "DESC" : "ASC").getMany();
        if (before && !after) bans.reverse();

        return res.json(
            bans.map((ban) => ({
                reason: ban.reason ?? null,
                user: {
                    username: ban.user.username,
                    discriminator: ban.user.discriminator,
                    global_name: ban.user.global_name ?? null,
                    id: ban.user.id,
                    avatar: ban.user.avatar ?? null,
                    public_flags: Number(ban.user.public_flags),
                },
            })) satisfies GuildBansResponse,
        );
    },
);

router.get(
    "/search",
    route({
        permission: "BAN_MEMBERS",
        query: {
            query: {
                type: "string",
                description: "Query to match username(s) and display name(s) against (1-32 characters)",
                required: true,
            },
            limit: {
                type: "number",
                description: "Max number of members to return (1-10, default 10)",
                required: false,
            },
        },
        responses: {
            200: {
                body: "GuildBansResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        const limit = Number(req.query.limit) || 10;
        if (limit > 10 || limit < 1) throw new HTTPError("Limit must be between 1 and 10");

        const query = String(req.query.query);
        if (!query || query.trim().length === 0 || query.length > 32) {
            throw new HTTPError("The query must be between 1 and 32 characters in length");
        }

        let bans = await Ban.createQueryBuilder("ban")
            .leftJoinAndSelect("ban.user", "user")
            .where("ban.guild_id = :guildId", { guildId: guild_id })
            .andWhere("user.username LIKE :userName", {
                userName: `%${query}%`,
            })
            .limit(limit)
            .getMany();

        bans = bans.filter((ban) => ban.user_id !== ban.executor_id); // pretend self-bans don't exist to prevent victim chasing

        const bansObj: GuildBansResponse = bans.map((ban) => {
            const user = ban.user;
            return {
                reason: ban.reason ?? null,
                user: {
                    username: user.username,
                    discriminator: user.discriminator,
                    id: user.id,
                    avatar: user.avatar ?? null,
                    public_flags: Number(user.public_flags),
                },
            };
        });

        return res.json(bansObj);
    },
);

router.get(
    "/:user_id",
    route({
        permission: "BAN_MEMBERS",
        responses: {
            200: {
                body: "GuildBanResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, user_id } = req.params as { [key: string]: string };

        const ban = (await Ban.findOneOrFail({
            where: { guild_id: guild_id, user_id: user_id },
        })) as BanRegistrySchema;

        if (ban.user_id === ban.executor_id) throw DiscordApiErrors.UNKNOWN_BAN;
        // pretend self-bans don't exist to prevent victim chasing

        const user = await User.getPublicUser(ban.user_id);

        const banInfo: GuildBanResponse = {
            user: {
                username: user.username,
                discriminator: user.discriminator,
                id: user.id,
                avatar: user.avatar ?? null,
                public_flags: user.public_flags,
            },
            reason: ban.reason ?? null,
        };

        return res.json(banInfo);
    },
);

router.put(
    "/:user_id",
    route({
        requestBody: "BanCreateSchema",
        permission: "BAN_MEMBERS",
        responses: {
            204: {},
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
        const banned_user_id = req.params.user_id as string;
        const opts = (req.body ?? {}) as BanCreateSchema;
        const delete_message_seconds = banDeleteSeconds(opts);

        if (req.user_id === banned_user_id && banned_user_id === req.permission?.cache.guild?.owner_id)
            throw new HTTPError("You are the guild owner, hence can't ban yourself", 403);
        if (req.permission?.cache.guild?.owner_id === banned_user_id) throw new HTTPError("You can't ban the owner", 400);
        if (!(await (await banHierarchy(guild_id, req.user_id))(banned_user_id))) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("BAN_MEMBERS");

        const headerReason = req.headers["x-audit-log-reason"];
        const reason = (Array.isArray(headerReason) ? headerReason[0] : headerReason) ?? opts.reason;
        await banUser({ guild_id, user_id: banned_user_id, executor_id: req.user_id, reason: reason ? decodeURIComponent(reason) : undefined, delete_message_seconds });

        return res.status(204).send();
    },
);

router.delete(
    "/:user_id",
    route({
        permission: "BAN_MEMBERS",
        responses: {
            204: {},
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, user_id } = req.params as { [key: string]: string };

        await Ban.findOneOrFail({
            where: { guild_id: guild_id, user_id: user_id },
        });

        const banned_user = await User.getPublicUser(user_id);

        await Promise.all([
            Ban.delete({
                user_id: user_id,
                guild_id,
            }),
            AuditLog.log({ guild_id, user_id: req.user_id, action_type: AuditLogEvents.MEMBER_BAN_REMOVE, target_id: user_id, reason: req.headers["x-audit-log-reason"] }),

            emitEvent({
                event: "GUILD_BAN_REMOVE",
                data: {
                    guild_id,
                    user: banned_user,
                },
                guild_id,
            } satisfies GuildBanRemoveEvent),
        ]);

        return res.status(204).send();
    },
);

export default router;
