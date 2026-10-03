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
import { Message } from "@spacebar/database";
import { EmbedType, MessageType } from "@spacebar/schemas";
import { DiscordApiErrors, emitEvent, FieldErrors, getPermission, MessageUpdateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const SET_COMPLETED = 1;
const UNSET_COMPLETED = 2;
const DELETE_USER_MESSAGE = 3;
const SUBMIT_FEEDBACK = 4;

router.post(
    "/",
    route({
        responses: {
            204: {},
            400: { body: "APIErrorResponse" },
            403: { body: "APIErrorResponse" },
            404: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const { message_id, channel_id, alert_action_type } = (req.body ?? {}) as { message_id?: string; channel_id?: string; alert_action_type?: number };
        if (![SET_COMPLETED, UNSET_COMPLETED, DELETE_USER_MESSAGE, SUBMIT_FEEDBACK].includes(Number(alert_action_type)))
            throw FieldErrors({ alert_action_type: { code: "BASE_TYPE_CHOICES", message: "Value must be one of (1, 2, 3, 4)." } });
        if (!channel_id || !message_id) throw DiscordApiErrors.UNKNOWN_MESSAGE;
        (await getPermission(req.user_id, guild_id, channel_id)).hasThrow("MANAGE_MESSAGES");

        const message = await Message.findOne({ where: { id: message_id, channel_id, guild_id, type: MessageType.AUTO_MODERATION_ACTION }, relations: { author: true } });
        const embed = message?.embeds?.[0];
        if (!message || !embed || embed.type !== EmbedType.auto_moderation_message) throw DiscordApiErrors.UNKNOWN_MESSAGE;

        const fields = embed.fields ?? [];
        const existing = fields.find((field) => field.name === "alert_actions_execution");
        let state: { actions: Record<string, { actor: string; ts: string }> } = { actions: {} };
        try {
            state = existing ? JSON.parse(existing.value) : state;
            state.actions ??= {};
        } catch {
            state = { actions: {} };
        }
        if (Number(alert_action_type) === UNSET_COMPLETED) delete state.actions[String(SET_COMPLETED)];
        else state.actions[String(alert_action_type)] = { actor: req.user_id, ts: new Date().toISOString() };

        const value = JSON.stringify(state);
        embed.fields = existing
            ? fields.map((field) => (field === existing ? { ...field, value } : field))
            : [...fields, { name: "alert_actions_execution", value, inline: false }];
        message.embeds = [embed, ...message.embeds.slice(1)];
        await Message.update({ id: message.id }, { embeds: message.embeds });
        await emitEvent({ event: "MESSAGE_UPDATE", channel_id, data: message.toJSON() } satisfies MessageUpdateEvent);
        return res.status(204).send();
    },
);

export default router;
