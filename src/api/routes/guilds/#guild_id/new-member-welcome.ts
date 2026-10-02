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
import { GuildHomeSettings } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const toResponse = (guild_id: string, settings?: Partial<GuildHomeSettings> | null): GuildHomeSettings => ({
    guild_id,
    enabled: settings?.enabled ?? false,
    welcome_message: settings?.welcome_message ?? { author_ids: [], message: "" },
    new_member_actions: settings?.new_member_actions ?? [],
    resource_channels: settings?.resource_channels ?? [],
});

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, home_settings: true } });
    res.json(toResponse(guild_id, guild.home_settings));
});

router.put("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, home_settings: true } });
    const settings = toResponse(guild_id, { ...toResponse(guild_id, guild.home_settings), ...(req.body as Partial<GuildHomeSettings>) });
    await Guild.update({ id: guild_id }, { home_settings: settings });
    res.json(settings);
});

export default router;
