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
import { Channel, Member, Recipient, User, userGuildSettingsEntry } from "@spacebar/database";
import { DefaultUserGuildSettings, UserGuildSettings, UserGuildSettingsSchema } from "@spacebar/schemas";
import { In } from "typeorm";
import { DiscordApiErrors } from "@spacebar/util";

const isPrivate = (guild_id: string) => guild_id === "@me" || guild_id === "null";

const router = Router({ mergeParams: true });

// GET doesn't exist on discord.com
router.get(
    "/",
    route({
        responses: {
            200: {},
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        if (isPrivate(guild_id)) {
            const user = await User.findOne({ where: { id: req.user_id }, select: { id: true, private_channel_settings: true } });
            return res.json(userGuildSettingsEntry(user?.private_channel_settings ?? DefaultUserGuildSettings, null));
        }
        const member = await Member.findOneOrFail({
            where: { id: req.user_id, guild_id },
            select: { settings: true },
        });
        return res.json(userGuildSettingsEntry(member.settings, guild_id));
    },
);

router.patch(
    "/",
    route({
        requestBody: "UserGuildSettingsSchema",
        responses: {
            200: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as UserGuildSettingsSchema;
        const guild_id = req.params.guild_id as string;
        const channel_ids = Object.keys(body.channel_overrides ?? {});

        if (isPrivate(guild_id)) {
            if (channel_ids.length && (await Recipient.count({ where: { user_id: req.user_id, channel_id: In(channel_ids) } })) !== channel_ids.length)
                throw DiscordApiErrors.UNKNOWN_CHANNEL;
            return res.json(await Member.updateGuildSettings(req.user_id, null, body as Partial<UserGuildSettings>));
        }

        if (channel_ids.length && (await Channel.count({ where: { id: In(channel_ids), guild_id } })) !== channel_ids.length) throw DiscordApiErrors.UNKNOWN_CHANNEL;

        res.json(await Member.updateGuildSettings(req.user_id, guild_id, body as Partial<UserGuildSettings>));
    },
);

export default router;
