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

import { route } from "@spacebar/api/middlewares";
import { Guild } from "@spacebar/database";
import { DiscordApiErrors, handleFile } from "@spacebar/util";
import { applyGuildTag, syncTagAdopters } from "@spacebar/api/util";
import { Request, Response, Router } from "express";
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

        guild.profile = profile;
        const tagChanged = applyGuildTag(guild, {
            tag: body.tag,
            badge: body.badge,
            badge_color_primary: body.badge_color_primary,
            badge_color_secondary: body.badge_color_secondary,
        });
        await guild.save();
        if (tagChanged) await syncTagAdopters(guild);

        await Guild.emitUpdate(guild_id);

        res.json((await guild.withPresenceCount()).toGuildProfile());
    },
);

export default router;
