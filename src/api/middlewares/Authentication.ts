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

import { NextFunction, Request, Response } from "express";
import { Session, User } from "@spacebar/database";
import { Random } from "@spacebar/extensions";
import { checkOAuth2Token, checkToken, getClientPlatform, isOAuth2AccessToken, Rights, UserTokenData } from "@spacebar/util";
import { CORS } from "./CORS";

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user_id: string;
            user_bot: boolean;
            tokenData: UserTokenData;
            token: { id: string; iat: number; ver?: number; did?: string };
            user: User;
            session?: Session;
            rights: Rights;
            fingerprint?: string;
            isAuthenticated: boolean;
            oauth2?: UserTokenData["oauth2"];
        }
    }
}

export async function Authentication(req: Request, res: Response, next: NextFunction) {
    if (req.method === "OPTIONS") return CORS(req, res, next);
    if (req.isAuthenticated !== undefined) return next();

    if (req.headers.cookie?.split("; ").find((x) => x.startsWith("__sb_sessid=")))
        req.fingerprint = req.headers.cookie
            .split("; ")
            .find((x) => x.startsWith("__sb_sessid="))!
            .split("=")[1];
    else
        res.setHeader(
            "Set-Cookie",
            `__sb_sessid=${(req.fingerprint = Random.getString("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 32))}; Secure; HttpOnly; SameSite=None; Path=/`,
        );

    await handleAuthentication(req);

    return next();
}

export async function handleAuthentication(req: Request) {
    if (!req.headers.authorization || /^Basic\s/i.test(req.headers.authorization)) {
        req.isAuthenticated = false;
        return;
    }

    try {
        const options = { ipAddress: req.ip, fingerprint: req.fingerprint };
        const { decoded, user, session, oauth2 } = (req.tokenData = isOAuth2AccessToken(req.headers.authorization)
            ? await checkOAuth2Token(req.headers.authorization, options)
            : await checkToken(req.headers.authorization, options));

        req.token = decoded;
        req.user_id = decoded.id;
        req.user_bot = user.bot;
        req.user = user;
        req.session = session;
        req.oauth2 = oauth2;
        req.rights = new Rights(Number(user.rights));
        req.isAuthenticated = true;

        const superProperties = req.headers["x-super-properties"];
        if (session && !session.client_info?.os && typeof superProperties === "string") {
            const properties = (() => {
                try {
                    return JSON.parse(Buffer.from(superProperties, "base64").toString("utf8"));
                } catch {
                    return null;
                }
            })();
            if (typeof properties?.os === "string" && properties.os) {
                const browser = typeof properties.browser === "string" ? properties.browser : undefined;
                session.client_info = { ...session.client_info, os: properties.os, browser, platform: getClientPlatform({ os: properties.os, browser }) };
                await Session.update({ session_id: session.session_id }, { client_info: session.client_info });
            }
        }
    } catch (e) {
        req.isAuthenticated = false;
        console.error("[Authentication] Token was provided, but was invalid:", e);
    }
}
