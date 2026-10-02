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

import { Request, Response, Router, urlencoded } from "express";
import { route } from "@spacebar/api/middlewares";
import {
    authenticateClient,
    CLIENT_CREDENTIALS_SCOPES,
    isPublicClient,
    issueOAuth2Token,
    OAuth2Error,
    OAUTH2_TOKEN_TTL,
    oauth2TokenResponse,
    pkceChallenge,
    randomOAuth2Token,
    readTicket,
} from "@spacebar/api/util";
import { ApplicationAuthorization, Guild, OAuth2Token } from "@spacebar/database";
import { hashOAuth2Token } from "@spacebar/util";

const router = Router({ mergeParams: true });

type CodeTicket = {
    typ: "oauth2_code";
    uid: string;
    app: string;
    scopes: string[];
    redirect_uri?: string;
    cc?: string;
    guild_id?: string;
};

const field = (body: Record<string, unknown>, key: string) => (typeof body[key] === "string" && body[key] ? (body[key] as string) : undefined);

router.post(
    "/",
    urlencoded({ extended: false }),
    route({
        authentication: "never",
        description: "Exchange an authorization code, refresh token or client credentials for an OAuth2 access token",
        responses: { 200: {}, 400: {}, 401: {} },
    }),
    async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const grant_type = field(body, "grant_type");
        res.setHeader("Cache-Control", "no-store");

        if (grant_type === "authorization_code") {
            const code = field(body, "code");
            const code_verifier = field(body, "code_verifier");
            const app = await authenticateClient(req, (app) => isPublicClient(app) && !!code_verifier);
            const ticket = readTicket<CodeTicket>(code, "oauth2_code");
            if (!code || !ticket || ticket.app !== app.id) throw OAuth2Error("invalid_grant", 'Invalid "code" in request.');
            if (ticket.cc) {
                if (!code_verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier)) throw OAuth2Error("invalid_request", 'Missing or invalid "code_verifier" in request.');
                if (pkceChallenge(code_verifier) !== ticket.cc) throw OAuth2Error("invalid_grant", 'Invalid "code_verifier" in request.');
            } else if (code_verifier) throw OAuth2Error("invalid_grant", 'Invalid "code_verifier" in request.');
            if (ticket.redirect_uri && field(body, "redirect_uri") !== ticket.redirect_uri) throw OAuth2Error("invalid_grant", 'Invalid "redirect_uri" in request.');

            const code_hash = hashOAuth2Token(code);
            const reused = await OAuth2Token.findOne({ where: { code_hash }, select: { id: true } });
            if (reused) {
                await OAuth2Token.delete({ id: reused.id });
                throw OAuth2Error("invalid_grant", 'Invalid "code" in request.');
            }
            const authorization = await ApplicationAuthorization.findOne({ where: { user_id: ticket.uid, application_id: app.id } });
            if (!authorization) throw OAuth2Error("invalid_grant", 'Invalid "code" in request.');

            const token = await issueOAuth2Token({
                user_id: ticket.uid,
                application_id: app.id,
                authorization_id: authorization.id,
                scopes: ticket.scopes,
                refresh: true,
                code_hash,
            }).catch((e: Error & { code?: string }) => {
                if (e.code === "23505") throw OAuth2Error("invalid_grant", 'Invalid "code" in request.');
                throw e;
            });
            const guild = ticket.guild_id
                ? await Guild.findOne({ where: { id: ticket.guild_id }, select: { id: true, name: true, icon: true, owner_id: true, features: true } })
                : null;
            return res.json({ ...token, ...(guild && { guild }) });
        }

        if (grant_type === "refresh_token") {
            const refresh_token = field(body, "refresh_token");
            const app = await authenticateClient(req, isPublicClient);
            const row = refresh_token ? await OAuth2Token.findOne({ where: { refresh_token_hash: hashOAuth2Token(refresh_token), application_id: app.id } }) : null;
            if (!row) throw OAuth2Error("invalid_grant", 'Invalid "refresh_token" in request.');
            const access_token = randomOAuth2Token();
            const next_refresh_token = randomOAuth2Token();
            const { affected } = await OAuth2Token.update(
                { id: row.id, refresh_token_hash: row.refresh_token_hash! },
                {
                    access_token_hash: hashOAuth2Token(access_token),
                    refresh_token_hash: hashOAuth2Token(next_refresh_token),
                    expires_at: new Date(Date.now() + OAUTH2_TOKEN_TTL * 1000),
                },
            );
            if (!affected) throw OAuth2Error("invalid_grant", 'Invalid "refresh_token" in request.');
            return res.json(oauth2TokenResponse(access_token, row.scopes, next_refresh_token));
        }

        if (grant_type === "client_credentials") {
            const app = await authenticateClient(req, () => false);
            const requested = [...new Set((field(body, "scope") ?? "identify").split(/[\s+]+/).filter(Boolean))];
            const invalid = requested.find((scope) => !CLIENT_CREDENTIALS_SCOPES.includes(scope));
            if (invalid || !requested.length) throw OAuth2Error("invalid_scope", `Invalid scope: ${invalid ?? ""}`);
            return res.json(await issueOAuth2Token({ user_id: app.team?.owner_user_id ?? app.owner_id, application_id: app.id, scopes: requested, refresh: false }));
        }

        throw OAuth2Error("unsupported_grant_type", 'Unsupported "grant_type" in request.');
    },
);

export default router;
