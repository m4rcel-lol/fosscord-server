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
import { Channel, Guild } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { WidgetModifySchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

// https://discord.com/developers/docs/resources/guild#get-guild-widget-settings
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GuildWidgetSettingsResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

        return res.json({
            enabled: guild.widget_enabled || false,
            channel_id: guild.widget_channel_id || null,
        });
    },
);

// https://discord.com/developers/docs/resources/guild#modify-guild-widget
router.patch(
    "/",
    route({
        requestBody: "WidgetModifySchema",
        permission: "MANAGE_GUILD",
        responses: {
            200: {
                body: "WidgetModifySchema",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as WidgetModifySchema;
        const { guild_id } = req.params as { [key: string]: string };

        if (body.channel_id && !/^\d{1,20}$/.test(body.channel_id))
            throw FieldErrors({ channel_id: { code: "NUMBER_TYPE_COERCE", message: `Value "${body.channel_id}" is not snowflake.` } });
        const [guild] = await Promise.all([
            Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, widget_enabled: true, widget_channel_id: true } }),
            body.channel_id ? Channel.findOneOrFail({ where: { id: body.channel_id, guild_id }, select: { id: true } }) : undefined,
        ]);
        if (body.enabled !== undefined) guild.widget_enabled = body.enabled;
        if (body.channel_id !== undefined) guild.widget_channel_id = body.channel_id || null;
        await Guild.update({ id: guild_id }, { widget_enabled: guild.widget_enabled, widget_channel_id: guild.widget_channel_id });
        // Widget invite for the widget_channel_id gets created as part of the /guilds/{guild.id}/widget.json request

        return res.json({ enabled: guild.widget_enabled, channel_id: guild.widget_channel_id ?? null });
    },
);

export default router;
