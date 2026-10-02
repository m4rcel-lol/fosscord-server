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
import { Guild } from "@spacebar/database";
import { GuildDiscoveryMetadata } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const toResponse = (guild: Guild) => ({
    guild_id: guild.id,
    primary_category_id: guild.discovery_metadata?.primary_category_id ?? guild.primary_category_id ?? 0,
    keywords: guild.discovery_metadata?.keywords ?? null,
    emoji_discoverability_enabled: guild.discovery_metadata?.emoji_discoverability_enabled ?? true,
    partner_actioned_timestamp: null,
    partner_application_timestamp: null,
    is_published: guild.features.includes("DISCOVERABLE"),
    reasons_to_join: guild.discovery_metadata?.reasons_to_join ?? [],
    social_links: guild.discovery_metadata?.social_links ?? null,
    about: guild.discovery_metadata?.about ?? null,
    category_ids: [],
});

router.get("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    res.json(toResponse(await Guild.findOneOrFail({ where: { id: guild_id } })));
});

router.patch("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const body = req.body as Partial<GuildDiscoveryMetadata>;
    const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
    const current = toResponse(guild);
    guild.discovery_metadata = {
        primary_category_id: body.primary_category_id ?? current.primary_category_id,
        keywords: body.keywords !== undefined ? body.keywords : current.keywords,
        emoji_discoverability_enabled: body.emoji_discoverability_enabled ?? current.emoji_discoverability_enabled,
        partner_actioned_timestamp: null,
        partner_application_timestamp: null,
        is_published: current.is_published,
        reasons_to_join: body.reasons_to_join ?? current.reasons_to_join,
        social_links: body.social_links !== undefined ? body.social_links : current.social_links,
        about: body.about !== undefined ? body.about : current.about,
    };
    if (body.primary_category_id != null) guild.primary_category_id = body.primary_category_id;
    await guild.save();
    res.json(toResponse(guild));
});

export default router;
