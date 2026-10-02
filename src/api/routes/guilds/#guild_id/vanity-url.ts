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
import { Channel, Guild, Invite } from "@spacebar/database";
import { ChannelType, VanityUrlSchema } from "@spacebar/schemas";
import { emitEvent, GuildUpdateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const InviteRegex = /\W/g;

router.get(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            200: {
                body: "GuildVanityUrlResponse",
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
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

        if (!guild.features.includes("ALIASABLE_NAMES")) {
            const invite = await Invite.findOne({
                where: { guild_id: guild_id, vanity_url: true },
            });
            if (!invite) return res.json({ code: null });

            return res.json({ code: invite.code, uses: invite.uses });
        } else {
            const invite = await Invite.find({
                where: { guild_id: guild_id, vanity_url: true },
            });
            if (!invite || invite.length == 0) return res.json({ code: null });

            return res.json(invite.map((x) => ({ code: x.code, uses: x.uses })));
        }
    },
);

router.patch(
    "/",
    route({
        requestBody: "VanityUrlSchema",
        permission: "MANAGE_GUILD",
        responses: {
            200: {
                body: "GuildVanityUrlCreateResponse",
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
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as VanityUrlSchema;
        const code = body.code?.replace(InviteRegex, "");

        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        if (!guild.features.includes("VANITY_URL")) throw new HTTPError("Your guild doesn't support vanity urls");

        if (!guild.features.includes("ALIASABLE_NAMES")) await Invite.delete({ guild_id, vanity_url: true });

        if (code) {
            if (code.length < 2 || code.length > 32) throw new HTTPError("Vanity URL must be between 2 and 32 characters", 400);
            if (await Invite.exists({ where: { code } })) throw new HTTPError("Vanity URL is already taken", 400);

            const channel_id =
                guild.rules_channel_id ??
                guild.system_channel_id ??
                (
                    await Channel.findOneOrFail({
                        where: { guild_id, type: ChannelType.GUILD_TEXT },
                    })
                ).id;

            await Invite.create({
                vanity_url: true,
                code,
                temporary: false,
                uses: 0,
                max_uses: 0,
                max_age: 0,
                created_at: new Date(),
                guild_id: guild_id,
                channel_id,
                flags: 0,
            }).save();
        }

        guild.vanity_url_code = code || null;
        await guild.save();
        await emitEvent({ event: "GUILD_UPDATE", data: guild.toJSON() as unknown as GuildUpdateEvent["data"], guild_id } satisfies GuildUpdateEvent);

        return res.json({ code: code || null });
    },
);

export default router;
