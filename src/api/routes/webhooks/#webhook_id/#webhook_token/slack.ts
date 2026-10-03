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

import { NextFunction, Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Embed, EmbedType, WebhookExecuteSchema } from "@spacebar/schemas";
import { executeWebhook } from "../../../../util/handlers/Webhook";

const router = Router({ mergeParams: true });

type SlackAttachment = {
    fallback?: string;
    color?: string;
    pretext?: string;
    author_name?: string;
    author_link?: string;
    author_icon?: string;
    title?: string;
    title_link?: string;
    text?: string;
    fields?: { title?: string; value?: string; short?: boolean }[];
    image_url?: string;
    thumb_url?: string;
    footer?: string;
    footer_icon?: string;
    ts?: number | string;
};

type SlackPayload = {
    text?: string;
    username?: string;
    icon_url?: string;
    attachments?: SlackAttachment[];
};

const slackColors: Record<string, number> = { good: 0x2eb886, warning: 0xdaa038, danger: 0xa30200 };

const slackText = (text?: string) =>
    text
        ?.replace(/<!(?:channel|everyone)>/g, "@everyone")
        .replace(/<!here>/g, "@here")
        .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, "[$2]($1)")
        .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

const slackEmbed = (attachment: SlackAttachment): Embed => {
    const color = attachment.color ? (slackColors[attachment.color] ?? parseInt(attachment.color.replace(/^#/, ""), 16)) : undefined;
    const ts = Number(attachment.ts);
    const description = [attachment.pretext, attachment.text].map(slackText).filter(Boolean).join("\n");
    return {
        type: EmbedType.rich,
        ...(attachment.title && { title: slackText(attachment.title) }),
        ...(attachment.title_link && { url: attachment.title_link }),
        ...(description && { description }),
        ...(color !== undefined && !Number.isNaN(color) && { color }),
        ...(attachment.author_name && { author: { name: attachment.author_name, url: attachment.author_link, icon_url: attachment.author_icon } }),
        ...(attachment.fields?.length && {
            fields: attachment.fields.map((field) => ({ name: slackText(field.title) || "​", value: slackText(field.value) || "​", inline: !!field.short })),
        }),
        ...(attachment.image_url && { image: { url: attachment.image_url } }),
        ...(attachment.thumb_url && { thumbnail: { url: attachment.thumb_url } }),
        ...(attachment.footer && { footer: { text: attachment.footer, icon_url: attachment.footer_icon } }),
        ...(attachment.ts !== undefined && !Number.isNaN(ts) && { timestamp: new Date(ts * 1000) }),
    } as Embed;
};

const parseSlackWebhook = (req: Request, _res: Response, next: NextFunction) => {
    const body = (typeof req.body?.payload === "string" ? JSON.parse(req.body.payload) : req.body) as SlackPayload | undefined;
    if (!body || typeof body !== "object") throw new HTTPError("Invalid Slack payload", 400);
    const payload: WebhookExecuteSchema = {
        ...(body.text && { content: slackText(body.text) }),
        ...(body.username && { username: body.username }),
        ...(body.icon_url && { avatar_url: body.icon_url }),
        ...(Array.isArray(body.attachments) && body.attachments.length && { embeds: body.attachments.slice(0, 10).map(slackEmbed) }),
    };
    req.body = payload;
    next();
};

router.post(
    "/",
    parseSlackWebhook,
    route({
        requestBody: "WebhookExecuteSchema",
        query: {
            wait: {
                type: "boolean",
                required: false,
                description: "waits for server confirmation of message send before response, and returns the created message body",
            },
            thread_id: {
                type: "string",
                required: false,
                description: "Send a message to the specified thread within a webhook's channel.",
            },
        },
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {},
        },
        authentication: "never",
    }),
    executeWebhook,
);

export default router;
