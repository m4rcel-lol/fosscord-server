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
import multer from "multer";
import { route } from "@spacebar/api/middlewares";
import { Application, Attachment, Message } from "@spacebar/database";
import { InteractionCallbacksSchema, InteractionCallbackType, InteractionFailureReason, InteractionType } from "@spacebar/schemas";
import {
    ApiError,
    ApplicationCommandAutocompleteResponseEvent,
    Config,
    DiscordApiErrors,
    emitEvent,
    InteractionModalCreateEvent,
    MessageFlags,
    pendingInteractions,
    Snowflake,
    uploadFile,
} from "@spacebar/util";
import {
    createInteractionMessage,
    editInteractionMessage,
    emitInteractionFailure,
    emitInteractionSuccess,
    fetchInteractionMessage,
    interactionTarget,
} from "@spacebar/api/util/handlers/Interaction";

const router = Router({ mergeParams: true });

const upload = multer({ limits: { fileSize: Config.get().limits.message.maxAttachmentSize, fields: 10 }, storage: multer.memoryStorage() });

router.post(
    "/",
    upload.any(),
    (req, _res, next) => {
        if (req.body.payload_json) req.body = JSON.parse(req.body.payload_json);
        next();
    },
    route({
        stripNulls: true,
        requestBody: "InteractionCallbacksSchema",
        authentication: "never",
        query: {
            with_response: { type: "boolean", required: false, description: "Whether to return the interaction callback response" },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as InteractionCallbacksSchema;
        const interaction = pendingInteractions.get(req.params.interaction_id as string);
        if (!interaction || interaction.token !== req.params.interaction_token) throw DiscordApiErrors.UNKNOWN_INTERACTION;
        if (interaction.acknowledged) throw new ApiError("Interaction has already been acknowledged.", 40060, 400);

        const allowed: Record<number, InteractionType[]> = {
            [InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE]: [InteractionType.ApplicationCommand, InteractionType.MessageComponent, InteractionType.ModalSubmit],
            [InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE]: [InteractionType.ApplicationCommand, InteractionType.MessageComponent, InteractionType.ModalSubmit],
            [InteractionCallbackType.DEFERRED_UPDATE_MESSAGE]: [InteractionType.MessageComponent, InteractionType.ModalSubmit],
            [InteractionCallbackType.UPDATE_MESSAGE]: [InteractionType.MessageComponent, InteractionType.ModalSubmit],
            [InteractionCallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT]: [InteractionType.ApplicationCommandAutocomplete],
            [InteractionCallbackType.MODAL]: [InteractionType.ApplicationCommand, InteractionType.MessageComponent],
        };
        if (!allowed[body.type]?.includes(interaction.type)) throw new ApiError("Interaction callback type is not valid for this interaction", 50035, 400);
        if ((body.type === InteractionCallbackType.UPDATE_MESSAGE || body.type === InteractionCallbackType.DEFERRED_UPDATE_MESSAGE) && !interaction.messageId)
            throw new ApiError("This interaction is not attached to a message", 50035, 400);

        clearTimeout(interaction.timeout);
        interaction.acknowledged = true;

        const files = (req.files as Express.Multer.File[]) ?? [];
        if (files.length && "data" in body && body.data && typeof body.data === "object") {
            const folder = Snowflake.generate();
            const uploaded = await Promise.all(files.map((file) => uploadFile(`/attachments/${interaction.channelId}/${folder}`, file).then((f) => Attachment.create(f))));
            (body.data as { attachments?: unknown[] }).attachments = uploaded;
        }

        let message: Message | null = null;
        try {
            switch (body.type) {
                case InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE:
                    message = await createInteractionMessage(interaction, body.data);
                    interaction.responseMessageId = message.id;
                    interaction.responseEphemeral = (message.flags & Number(MessageFlags.FLAGS.EPHEMERAL)) !== 0;
                    break;
                case InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE:
                    message = await createInteractionMessage(interaction, { flags: body.data?.flags }, { loading: true });
                    interaction.responseMessageId = message.id;
                    interaction.responseEphemeral = (message.flags & Number(MessageFlags.FLAGS.EPHEMERAL)) !== 0;
                    interaction.responseLoading = true;
                    break;
                case InteractionCallbackType.DEFERRED_UPDATE_MESSAGE:
                    interaction.responseMessageId = interaction.messageId;
                    break;
                case InteractionCallbackType.UPDATE_MESSAGE: {
                    const target = await fetchInteractionMessage(interaction.messageId!);
                    if (!target) throw DiscordApiErrors.UNKNOWN_MESSAGE;
                    message = await editInteractionMessage(interaction, target, body.data);
                    interaction.responseMessageId = message.id;
                    break;
                }
                case InteractionCallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT:
                    await emitEvent({
                        event: "APPLICATION_COMMAND_AUTOCOMPLETE_RESPONSE",
                        ...interactionTarget(interaction),
                        data: { nonce: interaction.nonce, choices: body.data.choices.slice(0, 25) },
                    } satisfies ApplicationCommandAutocompleteResponseEvent);
                    break;
                case InteractionCallbackType.MODAL: {
                    const application = await Application.findOneOrFail({ where: { id: interaction.applicationId }, relations: { bot: true } });
                    await emitEvent({
                        event: "INTERACTION_MODAL_CREATE",
                        ...interactionTarget(interaction),
                        data: {
                            id: interaction.id,
                            nonce: interaction.nonce,
                            channel_id: interaction.channelId,
                            custom_id: body.data.custom_id,
                            title: body.data.title,
                            components: body.data.components,
                            application: {
                                id: application.id,
                                name: application.name,
                                icon: application.icon ?? null,
                                description: application.description ?? "",
                                flags: application.flags,
                                bot: application.bot?.toPublicUser(),
                            },
                        },
                    } satisfies InteractionModalCreateEvent);
                    break;
                }
                default:
                    break;
            }
        } catch (error) {
            interaction.acknowledged = false;
            await emitInteractionFailure(interaction, InteractionFailureReason.UNKNOWN);
            throw error;
        }

        if (body.type !== InteractionCallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT) await emitInteractionSuccess(interaction);

        if (req.query.with_response !== "true") return res.sendStatus(204);
        return res.json({
            interaction: {
                id: interaction.id,
                type: interaction.type,
                activity_instance_id: undefined,
                response_message_id: interaction.responseMessageId,
                response_message_loading: interaction.responseLoading ?? false,
                response_message_ephemeral: interaction.responseEphemeral ?? false,
            },
            resource: {
                type: body.type,
                message: message?.toJSON(),
            },
        });
    },
);

export default router;
