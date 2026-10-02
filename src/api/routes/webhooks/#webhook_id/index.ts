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
import { AuditLog, Webhook } from "@spacebar/database";
import { DiscordApiErrors, getPermission, WebhooksUpdateEvent, emitEvent } from "@spacebar/util";
import { AuditLogEvents, type WebhookUpdateSchema } from "@spacebar/schemas";
import { applyWebhookUpdate, webhookToJSON } from "@spacebar/api/util/handlers/Webhook";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        description: "Returns a webhook object for the given id. Requires the MANAGE_WEBHOOKS permission or to be the owner of the webhook.",
        responses: {
            200: {
                body: "WebhookResponse",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { webhook_id } = req.params as { [key: string]: string };
        const webhook = await Webhook.findOneOrFail({
            where: { id: webhook_id },
            relations: { user: true, channel: true, source_channel: true, guild: true, source_guild: true, application: true },
        });

        if (webhook.guild_id) {
            const permission = await getPermission(req.user_id, webhook.guild_id);

            if (!permission.has("MANAGE_WEBHOOKS")) throw DiscordApiErrors.UNKNOWN_WEBHOOK;
        } else if (webhook.user_id != req.user_id) throw DiscordApiErrors.UNKNOWN_WEBHOOK;

        return res.json(webhookToJSON(webhook));
    },
);

router.delete(
    "/",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { webhook_id } = req.params as { [key: string]: string };

        const webhook = await Webhook.findOneOrFail({
            where: { id: webhook_id },
            relations: { user: true, channel: true, source_channel: true, guild: true, source_guild: true, application: true },
        });

        if (webhook.guild_id) {
            const permission = await getPermission(req.user_id, webhook.guild_id);

            if (!permission.has("MANAGE_WEBHOOKS")) throw DiscordApiErrors.UNKNOWN_WEBHOOK;
        } else if (webhook.user_id != req.user_id) throw DiscordApiErrors.UNKNOWN_WEBHOOK;

        const channel_id = webhook.channel_id;
        await Webhook.delete({ id: webhook_id });
        if (webhook.guild_id)
            await AuditLog.log({
                guild_id: webhook.guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.WEBHOOK_DELETE,
                target_id: webhook.id,
                changes: AuditLog.diff({ type: webhook.type, name: webhook.name, channel_id, avatar_hash: webhook.avatar }, {}, ["type", "name", "channel_id", "avatar_hash"]),
                reason: req.headers["x-audit-log-reason"],
            });

        await emitEvent({
            event: "WEBHOOKS_UPDATE",
            channel_id,
            data: {
                channel_id,
                guild_id: webhook.guild_id!, // TODO: is this even the right fix?
            },
        } satisfies WebhooksUpdateEvent);

        res.sendStatus(204);
    },
);

router.patch(
    "/",
    route({
        requestBody: "WebhookUpdateSchema",
        responses: {
            200: {
                body: "WebhookCreateResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {},
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { webhook_id } = req.params as { [key: string]: string };
        const body = req.body as WebhookUpdateSchema;

        const webhook = await Webhook.findOneOrFail({
            where: { id: webhook_id },
            relations: { user: true, channel: true, source_channel: true, guild: true, source_guild: true, application: true },
        });

        if (webhook.guild_id) {
            const permission = await getPermission(req.user_id, webhook.guild_id);

            if (!permission.has("MANAGE_WEBHOOKS")) throw DiscordApiErrors.UNKNOWN_WEBHOOK;
        } else if (webhook.user_id != req.user_id) throw DiscordApiErrors.UNKNOWN_WEBHOOK;

        const previousChannelId = webhook.channel_id;
        const before = { name: webhook.name, channel_id: webhook.channel_id, avatar_hash: webhook.avatar };
        await applyWebhookUpdate(webhook, body, true);
        const changes = AuditLog.diff(before, { name: webhook.name, channel_id: webhook.channel_id, avatar_hash: webhook.avatar }, ["name", "channel_id", "avatar_hash"]);
        if (webhook.guild_id && changes.length)
            await AuditLog.log({
                guild_id: webhook.guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.WEBHOOK_UPDATE,
                target_id: webhook.id,
                changes,
                reason: req.headers["x-audit-log-reason"],
            });
        const channel_id = webhook.channel_id;
        if (previousChannelId !== channel_id)
            await emitEvent({
                event: "WEBHOOKS_UPDATE",
                channel_id: previousChannelId,
                data: { channel_id: previousChannelId, guild_id: webhook.guild_id! },
            } satisfies WebhooksUpdateEvent);

        await Promise.all([
            webhook.save(),
            emitEvent({
                event: "WEBHOOKS_UPDATE",
                channel_id,
                data: {
                    channel_id,
                    guild_id: webhook.guild_id!, //TODO: is this even the right fix?
                },
            } satisfies WebhooksUpdateEvent),
        ]);

        res.json(webhookToJSON(webhook));
    },
);

export default router;
