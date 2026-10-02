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

import crypto from "node:crypto";
import { route } from "@spacebar/api/middlewares";
import { Guild, User } from "@spacebar/database";
import { Raw } from "typeorm";
import { DiscordApiErrors, emitEvent, GuildUpdateEvent, handleFile } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { GuildProfileModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            "200": {
                body: "GuildProfileResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOne({ where: { id: guild_id } });
        if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;

        res.send((await guild.withPresenceCount()).toGuildProfile());
    },
);

router.patch(
    "/",
    route({
        requestBody: "GuildProfileModifySchema",
        permission: "MANAGE_GUILD",
        responses: {
            "200": {
                body: "GuildProfileResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as GuildProfileModifySchema;
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        const profile = { ...(guild.profile ?? {}) };

        if (body.name != null) guild.name = body.name;
        if (body.description !== undefined) guild.description = body.description ?? undefined;
        if (body.icon !== undefined) guild.icon = body.icon ? await handleFile(`/icons/${guild_id}`, body.icon) : undefined;
        if (body.custom_banner !== undefined) profile.custom_banner_hash = body.custom_banner ? await handleFile(`/guild-space/${guild_id}/banner`, body.custom_banner) : null;
        if (body.visibility != null) profile.visibility = body.visibility;
        if (body.brand_color_primary !== undefined) profile.brand_color_primary = body.brand_color_primary;
        if (body.game_application_ids) profile.game_application_ids = body.game_application_ids;
        if (body.traits) profile.traits = body.traits.filter((trait) => trait?.label).map((trait, position) => ({ ...trait!, position: trait!.position ?? position }));

        if (body.tag !== undefined) {
            if (body.tag !== null && !/^[\p{L}\p{N}]{2,4}$/u.test(body.tag)) throw new HTTPError("Tag must be 2 to 4 letters or numbers", 400);
            profile.tag = body.tag;
        }
        if (body.badge !== undefined) profile.badge = body.badge;
        if (body.badge_color_primary !== undefined) profile.badge_color_primary = body.badge_color_primary;
        if (body.badge_color_secondary !== undefined) profile.badge_color_secondary = body.badge_color_secondary;
        if (body.badge !== undefined || body.badge_color_primary !== undefined || body.badge_color_secondary !== undefined)
            profile.badge_hash = crypto.createHash("md5").update(`${profile.badge}:${profile.badge_color_primary}:${profile.badge_color_secondary}`).digest("hex");

        guild.profile = profile;
        await guild.save();

        if (body.tag !== undefined || body.badge !== undefined || body.badge_color_primary !== undefined || body.badge_color_secondary !== undefined) {
            const adopters = await User.find({ where: { primary_guild: Raw((alias) => `${alias} ->> 'identity_guild_id' = :guild_id`, { guild_id }) } });
            for (const user of adopters) {
                user.primary_guild = profile.tag
                    ? { identity_guild_id: guild_id, identity_enabled: user.primary_guild?.identity_enabled ?? true, tag: profile.tag, badge: profile.badge_hash ?? null }
                    : { identity_guild_id: guild_id, identity_enabled: false, tag: null, badge: null };
                await user.save();
            }
        }

        await emitEvent({
            event: "GUILD_UPDATE",
            data: guild.toJSON() as unknown as GuildUpdateEvent["data"],
            guild_id,
        } satisfies GuildUpdateEvent);

        res.json((await guild.withPresenceCount()).toGuildProfile());
    },
);

export default router;
