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

import crypto from "node:crypto";
import { Request } from "express";
import { IsNull, LessThan } from "typeorm";
import { Application, ApplicationAuthorization, OAuth2Token, User } from "@spacebar/database";
import { emitEvent, hashOAuth2Token, OAuth2TokenDeleteEvent, Snowflake } from "@spacebar/util";
import { ResponseError } from "./mfa";

export const OAUTH2_TOKEN_TTL = 604800;
export const PUBLIC_OAUTH2_CLIENT = 1 << 8;
export const CLIENT_CREDENTIALS_SCOPES = [
    "identify",
    "email",
    "connections",
    "guilds",
    "guilds.members.read",
    "applications.commands.update",
    "applications.commands.permissions.update",
    "applications.entitlements",
    "role_connections.write",
];

export const OAuth2Error = (error: string, error_description: string, status = 400) => new ResponseError(status, { error, error_description });

export const randomOAuth2Token = () => crypto.randomBytes(24).toString("base64url");

export const hashClientSecret = (secret: string) => hashOAuth2Token(secret);

export const pkceChallenge = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

export function clientCredentialsOf(req: Request) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const basic = req.headers.authorization?.match(/^Basic\s+(.+)$/i);
    if (basic) {
        const decoded = Buffer.from(basic[1], "base64").toString("utf8");
        const split = decoded.indexOf(":");
        if (split !== -1) return { client_id: decodeURIComponent(decoded.slice(0, split)), client_secret: decodeURIComponent(decoded.slice(split + 1)) };
    }
    return {
        client_id: typeof body.client_id === "string" ? body.client_id : undefined,
        client_secret: typeof body.client_secret === "string" && body.client_secret ? body.client_secret : undefined,
    };
}

export async function authenticateClient(req: Request, secretOptional: (app: Application) => boolean) {
    const { client_id, client_secret } = clientCredentialsOf(req);
    if (!client_id || !/^\d{1,20}$/.test(client_id)) throw OAuth2Error("invalid_client", "Unknown client", 401);
    const app = await Application.findOne({
        where: { id: client_id },
        select: { id: true, name: true, owner_id: true, flags: true, redirect_uris: true, client_secret_hash: true, team: { id: true, owner_user_id: true } },
        relations: { team: true },
    });
    if (!app) throw OAuth2Error("invalid_client", "Unknown client", 401);
    if (client_secret === undefined) {
        if (secretOptional(app)) return app;
        throw OAuth2Error("invalid_client", "Missing client_secret", 401);
    }
    const expected = Buffer.from(app.client_secret_hash ?? "");
    const given = Buffer.from(hashClientSecret(client_secret));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw OAuth2Error("invalid_client", "Invalid client_secret", 401);
    return app;
}

export const isPublicClient = (app: Application) => (Number(app.flags ?? 0) & PUBLIC_OAUTH2_CLIENT) === PUBLIC_OAUTH2_CLIENT;

export async function issueOAuth2Token(opts: { user_id: string; application_id: string; authorization_id?: string; scopes: string[]; refresh: boolean; code_hash?: string }) {
    const access_token = randomOAuth2Token();
    const refresh_token = opts.refresh ? randomOAuth2Token() : undefined;
    await OAuth2Token.delete({ refresh_token_hash: IsNull(), expires_at: LessThan(new Date()) });
    await OAuth2Token.create({
        id: Snowflake.generate(),
        user_id: opts.user_id,
        application_id: opts.application_id,
        authorization_id: opts.authorization_id,
        scopes: opts.scopes,
        access_token_hash: hashOAuth2Token(access_token),
        refresh_token_hash: refresh_token ? hashOAuth2Token(refresh_token) : null,
        code_hash: opts.code_hash ?? null,
        expires_at: new Date(Date.now() + OAUTH2_TOKEN_TTL * 1000),
        created_at: new Date(),
    }).save();
    return oauth2TokenResponse(access_token, opts.scopes, refresh_token);
}

export const oauth2TokenResponse = (access_token: string, scopes: string[], refresh_token?: string) => ({
    token_type: "Bearer",
    access_token,
    expires_in: OAUTH2_TOKEN_TTL,
    ...(refresh_token && { refresh_token }),
    scope: scopes.join(" "),
});

export async function revokeOAuth2Grant(user_id: string, application_id: string) {
    await OAuth2Token.delete({ user_id, application_id });
    const authorization = await ApplicationAuthorization.findOne({ where: { user_id, application_id } });
    if (!authorization || authorization.integration_type === 1) return;
    await ApplicationAuthorization.delete({ id: authorization.id });
    await emitEvent({ event: "OAUTH2_TOKEN_DELETE", user_id, data: { id: authorization.id, application_id } } satisfies OAuth2TokenDeleteEvent);
}

export const oauth2User = (user: User, scopes: string[]) => ({
    ...user.toPartialUser(),
    flags: Number(user.flags ?? 0),
    premium_type: user.premium_type ?? 0,
    mfa_enabled: !!user.mfa_enabled,
    locale: user.settings?.locale ?? "en-US",
    ...(scopes.includes("email") && { email: user.email ?? null, verified: !!user.verified }),
});
