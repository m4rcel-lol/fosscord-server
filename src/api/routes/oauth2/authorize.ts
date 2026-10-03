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
import { Application, ApplicationAuthorization, AuditLog, Member, Role, User } from "@spacebar/database";
import {
    DiscordApiErrors,
    FieldErrors,
    Permissions,
    Snowflake,
    emitEvent,
    getPermission,
    GuildIntegrationUpdateEvent,
    GuildRoleCreateEvent,
    GuildRoleDeleteEvent,
    GuildRoleUpdateEvent,
    OAuth2TokenCreateEvent,
} from "@spacebar/util";
import { emitCommandIndexUpdate } from "@spacebar/api/util/handlers/ApplicationCommands";
import { issueOAuth2Token, signTicket } from "@spacebar/api/util";
import { toPublicApplication } from "@spacebar/api/util/handlers/Application";
import { randomBytes } from "node:crypto";
import { ApplicationAuthorizeSchema, AuditLogEvents } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const requestedScopes = (scope: unknown, fallback: string[] = []) => {
    const scopes = String(scope ?? "")
        .split(/[\s+]+/)
        .filter(Boolean);
    return [...new Set(scopes.length ? scopes : fallback)];
};

const integrationTypeOf = (app: Application, req: Request, body?: ApplicationAuthorizeSchema) => {
    const config = app.integration_types_config;
    const requested =
        body?.integration_type !== undefined && body.integration_type !== null
            ? Number(body.integration_type)
            : req.query.integration_type !== undefined
              ? Number(req.query.integration_type)
              : config && !("0" in config) && "1" in config
                ? 1
                : 0;
    if (config && !(String(requested) in config))
        throw FieldErrors({ integration_type: { code: "APPLICATION_INTEGRATION_TYPE_NOT_SUPPORTED", message: "This application does not support this installation type." } });
    return requested;
};

const pkceOf = (req: Request) => {
    const { code_challenge, code_challenge_method } = req.query;
    if (code_challenge === undefined && code_challenge_method === undefined) return undefined;
    if (typeof code_challenge !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(code_challenge))
        throw FieldErrors({ code_challenge: { code: "INVALID_OAUTH2_CODE_CHALLENGE", message: "Invalid code_challenge" } });
    if (code_challenge_method !== "S256")
        throw FieldErrors({ code_challenge_method: { code: "INVALID_OAUTH2_CODE_CHALLENGE_METHOD", message: "code_challenge_method must be S256" } });
    return code_challenge;
};

const invalidRedirect = () => FieldErrors({ redirect_uri: { code: "INVALID_OAUTH2_REDIRECT_URI", message: "Invalid OAuth2 redirect_uri" } });

const redirectFor = (app: Application, redirect_uri: unknown) => {
    if (typeof redirect_uri === "string" && redirect_uri) {
        if (!app.redirect_uris?.includes(redirect_uri)) throw invalidRedirect();
        return redirect_uri;
    }
    if (redirect_uri !== undefined) throw invalidRedirect();
    return app.redirect_uris?.length === 1 ? app.redirect_uris[0] : null;
};

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
        const integrationType = integrationTypeOf(app, req);
        const scopes = requestedScopes(req.query.scope, integrationType === 1 ? ["applications.commands"] : ["bot"]);
        if (!app.bot && scopes.includes("bot") && integrationType !== 1) throw DiscordApiErrors.OAUTH2_APPLICATION_BOT_ABSENT;
        if (req.query.response_type === "code" || req.query.response_type === "token") redirectFor(app, req.query.redirect_uri);
        pkceOf(req);
        const existing = await ApplicationAuthorization.findOne({ where: { user_id: req.user_id, application_id: app.id } });

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
            redirect_uri: typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined,
            authorized:
                integrationType === 1 ? existing?.integration_type === 1 : !scopes.includes("bot") && !!existing && scopes.every((scope) => existing.scopes.includes(scope)),
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
        const integrationType = integrationTypeOf(app, req, body);
        const scopes = requestedScopes(req.query.scope, integrationType === 1 ? ["applications.commands"] : ["bot"]);
        const code_challenge = pkceOf(req);
        const authorizeUser = async (type: number) => {
            const existing = await ApplicationAuthorization.findOne({ where: { user_id: req.user_id, application_id: app.id } });
            const authorization = await ApplicationAuthorization.save({
                ...(existing ?? { id: Snowflake.generate(), created_at: new Date() }),
                user_id: req.user_id,
                application_id: app.id,
                integration_type: type === 1 ? 1 : (existing?.integration_type ?? 0),
                scopes: [...new Set([...(existing?.scopes ?? []), ...scopes.filter((scope) => scope !== "bot")])],
            } as ApplicationAuthorization);
            await emitEvent({
                event: "OAUTH2_TOKEN_CREATE",
                user_id: req.user_id,
                data: { id: authorization.id, scopes: authorization.scopes, application: toPublicApplication(app) },
            } satisfies OAuth2TokenCreateEvent);
            return authorization;
        };
        const codeFor = (guild_id?: string) =>
            signTicket(
                {
                    typ: "oauth2_code",
                    uid: req.user_id,
                    app: app.id,
                    scopes,
                    redirect_uri: typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined,
                    cc: code_challenge,
                    guild_id,
                    n: randomBytes(8).toString("hex"),
                },
                600,
            );
        if (integrationType === 1) {
            await authorizeUser(1);
            return res.json({ location: "/oauth2/authorized" });
        }
        if (!scopes.includes("bot") && !body.guild_id) {
            const response_type = req.query.response_type ?? "code";
            if (response_type !== "code" && response_type !== "token") throw FieldErrors({ response_type: { code: "INVALID_RESPONSE_TYPE", message: "Invalid response_type" } });
            const redirect = redirectFor(app, req.query.redirect_uri);
            const authorization = await authorizeUser(0);
            if (response_type === "token") {
                const token = await issueOAuth2Token({ user_id: req.user_id, application_id: app.id, authorization_id: authorization.id, scopes, refresh: false });
                const fragment = new URLSearchParams({
                    token_type: token.token_type,
                    access_token: token.access_token,
                    expires_in: String(token.expires_in),
                    scope: token.scope,
                    ...(typeof req.query.state === "string" && { state: req.query.state }),
                });
                return res.json({ location: `${redirect ?? "/oauth2/authorized"}#${fragment}` });
            }
            if (!redirect) return res.json({ location: "/oauth2/authorized" });
            const location = new URL(redirect);
            location.searchParams.set("code", codeFor());
            if (typeof req.query.state === "string") location.searchParams.set("state", req.query.state);
            return res.json({ location: location.toString() });
        }
        if (!app.bot) throw DiscordApiErrors.OAUTH2_APPLICATION_BOT_ABSENT;
        if (app.bot_public === false && app.owner_id !== req.user_id) throw new HTTPError("This bot is private, so only its owner can add it to servers.", 403);
        if (app.bot_require_code_grant && req.query.response_type !== "code") throw new HTTPError("This bot can only be added through the full OAuth2 code grant flow.", 400);
        if (!body.guild_id) throw FieldErrors({ guild_id: { code: "BASE_TYPE_REQUIRED", message: req.t("common:field.BASE_TYPE_REQUIRED") } });

        const perms = await getPermission(req.user_id, body.guild_id, undefined, { member_relations: ["user"] });
        if (Object.keys(perms.cache || {}).length > 0 && perms.cache.member?.user.bot) throw DiscordApiErrors.UNAUTHORIZED;
        perms.hasThrow("MANAGE_GUILD");

        if (await Member.exists({ where: { id: app.bot.id, guild_id: body.guild_id } })) return res.json({ location: "/oauth2/authorized" });

        await Member.addToGuild(app.bot.id, body.guild_id);
        await AuditLog.log({ guild_id: body.guild_id, user_id: req.user_id, action_type: AuditLogEvents.BOT_ADD, target_id: app.bot.id });
        await AuditLog.log({
            guild_id: body.guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.INTEGRATION_CREATE,
            target_id: app.id,
            changes: AuditLog.diff({}, { type: "discord", name: app.name }, ["type", "name"]),
        });
        const permissions = (/^\d+$/.test(body.permissions ?? "") ? BigInt(body.permissions!) : 0n) & perms.bitfield;
        const existingRoles = (await Role.find({ where: { guild_id: body.guild_id, managed: true } })).filter((role) => role.tags?.bot_id === app.bot!.id);
        for (const stale of existingRoles.slice(permissions ? 1 : 0)) {
            await Role.delete({ id: stale.id });
            await emitEvent({ event: "GUILD_ROLE_DELETE", guild_id: body.guild_id, data: { guild_id: body.guild_id, role_id: stale.id } } satisfies GuildRoleDeleteEvent);
        }
        const [existingRole] = existingRoles;
        if (permissions && existingRole) {
            existingRole.permissions = permissions.toString();
            existingRole.name = app.name;
            await existingRole.save();
            await emitEvent({ event: "GUILD_ROLE_UPDATE", guild_id: body.guild_id, data: { guild_id: body.guild_id, role: existingRole } } satisfies GuildRoleUpdateEvent);
            await Member.addRole(app.bot.id, body.guild_id, existingRole.id);
        } else if (permissions) {
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
        await emitEvent({ event: "GUILD_INTEGRATIONS_UPDATE", guild_id: body.guild_id, data: { guild_id: body.guild_id } } satisfies GuildIntegrationUpdateEvent);
        await emitCommandIndexUpdate(app.id, body.guild_id);

        const redirect = req.query.response_type === "code" ? redirectFor(app, req.query.redirect_uri) : null;
        if (!redirect) return res.json({ location: "/oauth2/authorized" });
        await authorizeUser(0);
        const location = new URL(redirect);
        location.searchParams.set("code", codeFor(body.guild_id));
        location.searchParams.set("guild_id", body.guild_id);
        location.searchParams.set("permissions", permissions.toString());
        if (typeof req.query.state === "string") location.searchParams.set("state", req.query.state);
        return res.json({ location: location.toString() });
    },
);

export default router;
