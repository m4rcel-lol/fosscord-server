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

import { Router, Request, Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { User } from "@spacebar/database";
import { OAuth2UserInfoResponse } from "@spacebar/schemas/api/oauth2/OAuth2UserInfo";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        description: "Get standard OAuth2 user info",
        oauth2: ["openid", "identify"],
        responses: {
            200: {
                body: "OAuth2UserInfoResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const emailScope = !req.oauth2 || req.oauth2.scopes.includes("email");
        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { id: true, username: true, avatar: true, email: true, verified: true },
            relations: { settings: true },
        });
        const cdn = Config.get().cdn.endpointPublic?.replace(/\/+$/, "");
        res.json({
            sub: user.id,
            email: emailScope ? (user.email ?? null) : null,
            email_verified: emailScope ? !!user.verified : false,
            preferred_username: user.username,
            nickname: user.username,
            picture: user.avatar ? `${cdn}/avatars/${user.id}/${user.avatar}.png` : `${cdn}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`,
            locale: user.settings?.locale ?? "en-US",
        } satisfies OAuth2UserInfoResponse);
    },
);

export default router;
