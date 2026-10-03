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
import { route } from "@spacebar/api/middlewares";
import { Guild, Message, User } from "@spacebar/database";
import { EmbedType, MessageType } from "@spacebar/schemas";
import { emitEvent, MessageUpdateEvent } from "@spacebar/util";
import { postGuildSystemMessage, safetyChannelId } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            204: {},
            403: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const { alert_message_id, reason } = (req.body ?? {}) as { alert_message_id?: string; reason?: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        guild.incidents_data = {
            invites_disabled_until: guild.incidents_data?.invites_disabled_until ?? null,
            dms_disabled_until: guild.incidents_data?.dms_disabled_until ?? null,
            lockdown_duration_hours: guild.incidents_data?.lockdown_duration_hours ?? null,
            raid_detected_at: null,
            dm_spam_detected_at: null,
        };
        await Guild.update({ id: guild_id }, { incidents_data: guild.incidents_data });
        await Guild.emitUpdate(guild_id);

        const alert =
            alert_message_id && /^\d{1,20}$/.test(alert_message_id) ? await Message.findOne({ where: { id: alert_message_id, guild_id }, relations: { author: true } }) : null;
        const embed = alert?.embeds?.[0];
        if (alert && embed?.type === EmbedType.auto_moderation_notification) {
            embed.fields = [
                ...(embed.fields ?? []).filter((field) => field.name !== "resolved_reason"),
                { name: "resolved_reason", value: String(reason ?? "OTHER"), inline: false },
            ];
            await Message.update({ id: alert.id }, { embeds: alert.embeds });
            await emitEvent({ event: "MESSAGE_UPDATE", channel_id: alert.channel_id, data: alert.toJSON() } satisfies MessageUpdateEvent);
        }

        const channel_id = safetyChannelId(guild);
        if (channel_id)
            await postGuildSystemMessage({
                guild_id,
                channel_id,
                author: await User.findOneOrFail({ where: { id: req.user_id } }),
                type: MessageType.GUILD_INCIDENT_REPORT_FALSE_ALARM,
            });
        return res.status(204).send();
    },
);

export default router;
