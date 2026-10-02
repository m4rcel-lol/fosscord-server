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
import { Application, ApplicationAuthorization, Member, Role, User } from "@spacebar/database";
import { DiscordApiErrors, FieldErrors, Permissions, Snowflake, emitEvent, getPermission, GuildRoleCreateEvent } from "@spacebar/util";
import { emitCommandIndexUpdate } from "@spacebar/api/util/handlers/ApplicationCommands";
import { ApplicationAuthorizeSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

// TODO: scopes, other oauth types

router.get(
    "/",
    route({
        query: {
            client_id: {
                type: "string",
            },
        },
        responses: {
            // TODO: I really didn't feel like typing all of it out
            200: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        // const { client_id, scope, response_type, redirect_url } = req.query;
        const { client_id } = req.query;
        if (!client_id) {
            throw FieldErrors({
                client_id: {
                    code: "BASE_TYPE_REQUIRED",
                    message: req.t("common:field.BASE_TYPE_REQUIRED"),
                },
            });
        }

        const app = await Application.findOne({
            where: {
                id: client_id as string,
            },
            relations: { bot: true },
        });

        // TODO: use DiscordApiErrors
        // findOneOrFail throws code 404
        if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
        if (!app.bot && req.query.integration_type !== "1") throw DiscordApiErrors.OAUTH2_APPLICATION_BOT_ABSENT;

        const bot = app.bot;
        delete app.bot;

        const user = await User.findOneOrFail({
            where: {
                id: req.user_id,
                bot: false,
            },
            select: { id: true, username: true, avatar: true, discriminator: true, public_flags: true },
        });

        const guilds = await Member.find({
            where: {
                id: req.user_id,
            },
            relations: { guild: true, roles: true, user: true },
            select: {
                guild: { id: true, name: true, icon: true, mfa_level: true, owner_id: true },
                roles: { id: true },
                user: { flags: true },
            },
        });

        const guildsWithPermissions = guilds.map((x) => {
            const perms = Permissions.finalPermission({
                user: {
                    id: user.id,
                    roles: x.roles?.map((x) => x.id) || [],
                    communication_disabled_until: x.communication_disabled_until,
                    flags: x.user.flags,
                },
                guild: {
                    roles: x?.roles || [],
                    id: x.guild.id,
                    owner_id: x.guild.owner_id!, // ownerless guilds...?
                },
            });

            return {
                id: x.guild.id,
                name: x.guild.name,
                icon: x.guild.icon,
                mfa_level: x.guild.mfa_level,
                permissions: perms.bitfield.toString(),
            };
        });

        return res.json({
            guilds: guildsWithPermissions,
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar,
                avatar_decoration: null, // TODO
                discriminator: user.discriminator,
                public_flags: user.public_flags,
            },
            application: {
                id: app.id,
                name: app.name,
                icon: app.icon,
                description: app.description,
                summary: app.summary,
                type: app.type,
                hook: app.hook,
                guild_id: null, // TODO support guilds
                bot_public: app.bot_public,
                bot_require_code_grant: app.bot_require_code_grant,
                verify_key: app.verify_key,
                flags: app.flags,
            },
            bot: bot && {
                id: bot.id,
                username: bot.username,
                avatar: bot.avatar,
                avatar_decoration: null, // TODO
                discriminator: bot.discriminator,
                public_flags: bot.public_flags,
                bot: true,
                approximated_guild_count: await Member.count({ where: { id: bot.id } }),
            },
            authorized:
                req.query.integration_type === "1"
                    ? await ApplicationAuthorization.exists({ where: { user_id: req.user_id, application_id: app.id, integration_type: 1 } })
                    : false,
        });
    },
);

router.post(
    "/",
    route({
        requestBody: "ApplicationAuthorizeSchema",
        query: {
            client_id: {
                type: "string",
            },
        },
        responses: {
            200: {
                body: "OAuthAuthorizeResponse",
            },
            400: {
                body: "APIErrorResponse",
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
        const body = req.body as ApplicationAuthorizeSchema;
        // const { client_id, scope, response_type, redirect_url } = req.query;
        const { client_id } = req.query;

        if (!client_id) {
            throw FieldErrors({
                client_id: {
                    code: "BASE_TYPE_REQUIRED",
                    message: req.t("common:field.BASE_TYPE_REQUIRED"),
                },
            });
        }

        if (!body.authorize) return res.json({ location: "/oauth2/authorized" });

        const app = await Application.findOne({
            where: {
                id: client_id as string,
            },
            relations: { bot: true },
        });
        if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
        if (body.integration_type === 1) {
            const scopes = String(req.query.scope ?? "applications.commands")
                .split(/[\s+]+/)
                .filter(Boolean);
            const existing = await ApplicationAuthorization.findOne({ where: { user_id: req.user_id, application_id: app.id } });
            await ApplicationAuthorization.save({
                ...(existing ?? { id: Snowflake.generate(), created_at: new Date() }),
                user_id: req.user_id,
                application_id: app.id,
                integration_type: 1,
                scopes: [...new Set([...(existing?.scopes ?? []), ...scopes])],
            } as ApplicationAuthorization);
            return res.json({ location: "/oauth2/authorized" });
        }
        if (!app.bot) throw DiscordApiErrors.OAUTH2_APPLICATION_BOT_ABSENT;
        if (!body.guild_id) throw FieldErrors({ guild_id: { code: "BASE_TYPE_REQUIRED", message: req.t("common:field.BASE_TYPE_REQUIRED") } });

        const perms = await getPermission(req.user_id, body.guild_id, undefined, { member_relations: ["user"] });
        if (Object.keys(perms.cache || {}).length > 0 && perms.cache.member?.user.bot) throw DiscordApiErrors.UNAUTHORIZED;
        perms.hasThrow("MANAGE_GUILD");

        if (await Member.exists({ where: { id: app.bot.id, guild_id: body.guild_id } })) return res.json({ location: "/oauth2/authorized" });

        await Member.addToGuild(app.bot.id, body.guild_id);
        const permissions = new Permissions(body.permissions ?? "0").bitfield & perms.bitfield;
        if (permissions) {
            const role = Role.create({
                managed: true,
                name: app.name,
                permissions: permissions.toString(),
                guild_id: body.guild_id,
                color: 0,
                colors: { primary_color: 0 },
                hoist: false,
                mentionable: false,
                position: 1,
                tags: { bot_id: app.bot.id },
            });
            await role.save();
            await emitEvent({ event: "GUILD_ROLE_CREATE", guild_id: body.guild_id, data: { guild_id: body.guild_id, role } } satisfies GuildRoleCreateEvent);
            await Member.addRole(app.bot.id, body.guild_id, role.id);
        }
        await emitCommandIndexUpdate(app.id, body.guild_id);

        return res.json({
            location: "/oauth2/authorized", // redirect URL
        });
    },
);

export default router;
