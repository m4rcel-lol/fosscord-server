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

import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Guild, Webhook } from "@spacebar/database";
import { WebhookType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ permission: "VIEW_CHANNEL", responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const followers = await Webhook.find({ where: { type: WebhookType.ChannelFollower, source_channel_id: channel_id }, select: { id: true, guild_id: true } });
    const guildIds = [...new Set(followers.map((w) => w.guild_id).filter((id): id is string => !!id))];
    const guilds = guildIds.length ? await Guild.find({ where: { id: In(guildIds) }, select: { id: true, member_count: true } }) : [];
    const guildMembers = guilds.reduce((sum, g) => sum + (g.member_count ?? 0), 0);

    return res.json({
        channels_following: followers.length,
        guilds_following: guildIds.length,
        guild_members: guildMembers,
        users_seen_ever: guildMembers,
        subscribers_gained_since_last_post: 0,
        subscribers_lost_since_last_post: 0,
    });
});

export default router;
