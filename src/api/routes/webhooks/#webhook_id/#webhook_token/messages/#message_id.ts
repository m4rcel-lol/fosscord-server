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
import { HTTPError } from "lambert-server/HTTPError";
import multer from "multer";
import { handleMessage, postHandleMessage } from "@spacebar/api/util";
import { route } from "@spacebar/api/middlewares";
import { Channel, Message, Webhook } from "@spacebar/database";
import { MessageDeleteEvent, MessageUpdateEvent, emitEvent, DiscordApiErrors, getInteractionByToken } from "@spacebar/util";
import { deleteInteractionMessage, editInteractionMessage, fetchInteractionMessage, messageBelongsToInteraction } from "@spacebar/api/util/handlers/Interaction";
import { ChannelType, PublicMessage, WebhookExecuteSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

async function interactionMessage(req: Request) {
    const { webhook_id, webhook_token, message_id } = req.params as { [key: string]: string };
    const interaction = getInteractionByToken(webhook_id, webhook_token);
    if (!interaction) return undefined;
    const id = message_id === "@original" ? interaction.responseMessageId : /^\d+$/.test(message_id) ? message_id : undefined;
    const message = id ? await fetchInteractionMessage(id) : null;
    if (!message) throw DiscordApiErrors.UNKNOWN_MESSAGE;
    const isSource = message.id === interaction.messageId && message.application_id === interaction.applicationId;
    if (!isSource && !messageBelongsToInteraction(interaction, message)) throw DiscordApiErrors.UNKNOWN_MESSAGE;
    return { interaction, message };
}
// TODO: message content/embed string length limit

async function assertValidWebhookAuth(webhookId: string, webhookToken: string, messageId: string) {
    const webhook = await Webhook.findOne({ where: { id: webhookId } });
    if (!webhook) throw DiscordApiErrors.UNKNOWN_WEBHOOK;
    if (webhook.token != webhookToken) throw DiscordApiErrors.INVALID_WEBHOOK_TOKEN_PROVIDED;

    // TODO: fix error responses
    if (!/^\d+$/.test(messageId)) throw DiscordApiErrors.UNKNOWN_MESSAGE;
    const message = await Message.findOne({ where: { id: messageId } });
    if (!message) throw new HTTPError(`No message found with ID ${messageId}`, 404);
    if (webhook.id != message?.webhook_id) throw new HTTPError(`Message does not belong to webhook ${message.webhook_id}`, 401);
    if (webhook.channel_id != message?.channel_id) throw new HTTPError(`Message does not belong to webhook channel ${message.channel_id}`, 401);
}

const messageUpload = multer({
    limits: {
        fileSize: 1024 * 1024 * 100,
        fields: 10,
        files: 1,
    },
    storage: multer.memoryStorage(),
}); // max upload 50 mb

router.patch(
    "/",
    route({
        requestBody: "WebhookExecuteSchema",
        responses: {
            200: {
                body: "PublicMessage",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {},
            404: {},
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { webhook_id, webhook_token, message_id } = req.params as { [key: string]: string };
        const body = req.body as WebhookExecuteSchema;

        const fromInteraction = await interactionMessage(req);
        if (fromInteraction) {
            const edited = await editInteractionMessage(fromInteraction.interaction, fromInteraction.message, body as Parameters<typeof editInteractionMessage>[2]);
            if (edited.id === fromInteraction.interaction.responseMessageId) fromInteraction.interaction.responseLoading = false;
            return res.json(edited.toJSON());
        }

        await assertValidWebhookAuth(webhook_id, webhook_token, message_id);

        const message = await Message.findOneOrFail({
            where: { id: message_id, webhook_id: webhook_id },
            relations: { attachments: true },
        });

        const new_message = await handleMessage({
            ...message,
            // TODO: should message_reference be overridable?
            message_reference: message.message_reference,
            ...body,
            // author_id: message.author_id,
            author_id: undefined, // skip rights check
            webhook_id: message.webhook_id,
            channel_id: message.channel_id,
            id: message_id,
            edited_timestamp: new Date(),
        });

        await new_message.save();
        await emitEvent({
            event: "MESSAGE_UPDATE",
            channel_id: message.channel_id,
            data: {
                ...new_message.toJSON(),
                nonce: undefined,
            },
        } satisfies MessageUpdateEvent);

        postHandleMessage(new_message).catch((e) => console.error("[Message] post-message handler failed", e));
        return res.json(new_message.toJSON());
    },
);

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "PublicMessage",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {},
            404: {},
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { webhook_id, webhook_token, message_id } = req.params as { [key: string]: string };

        const fromInteraction = await interactionMessage(req);
        if (fromInteraction) return res.json(fromInteraction.message.toJSON());

        await assertValidWebhookAuth(webhook_id, webhook_token, message_id);

        const message = await Message.findOneOrFail({
            where: { id: message_id, webhook_id: webhook_id },
            relations: {
                attachments: true,
                author: true,
            },
        });

        return res.json(message.toJSON());
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
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { webhook_id, webhook_token, message_id } = req.params as { [key: string]: string };

        const fromInteraction = await interactionMessage(req);
        if (fromInteraction) {
            await deleteInteractionMessage(fromInteraction.interaction, fromInteraction.message);
            return res.sendStatus(204);
        }

        await assertValidWebhookAuth(webhook_id, webhook_token, message_id);

        const message = await Message.findOneOrFail({
            where: { id: message_id, webhook_id: webhook_id },
        });

        const channel = await Channel.findOneOrFail({
            where: { id: message.channel_id },
        });

        if (channel.type === ChannelType.GUILD_PUBLIC_THREAD) {
            if (channel.message_count !== undefined) channel.message_count--;
            await channel.save();
        }

        await Message.delete({ id: message_id, webhook_id: webhook_id });

        await emitEvent({
            event: "MESSAGE_DELETE",
            channel_id: message.channel_id,
            data: {
                id: message_id,
                channel_id: message.channel_id!,
                guild_id: channel.guild_id,
            },
        } satisfies MessageDeleteEvent);

        res.sendStatus(204);
    },
);

export default router;
