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

import { HTTPError } from "lambert-server/HTTPError";
import { In } from "typeorm";
import { Application, Attachment, Channel, Member, Message, Role, User } from "@spacebar/database";
import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    BaseMessageComponents,
    InteractionCallbacksSchema,
    InteractionCallbackType,
    InteractionFailureReason,
    InteractionMessage,
    InteractionType,
    MessageType,
} from "@spacebar/schemas";
import {
    ApiError,
    ApplicationCommandAutocompleteResponseEvent,
    Config,
    DiscordApiErrors,
    emitEvent,
    getPermission,
    InteractionFailureEvent,
    InteractionModalCreateEvent,
    InteractionSuccessEvent,
    MessageCreateEvent,
    MessageDeleteEvent,
    MessageFlags,
    MessageUpdateEvent,
    PendingInteraction,
    Snowflake,
    uploadFile,
} from "@spacebar/util";
import { handleComps, handleMessage, postHandleMessage } from "./Message";

const SETTABLE_FLAGS =
    Number(MessageFlags.FLAGS.SUPPRESS_EMBEDS) |
    Number(MessageFlags.FLAGS.EPHEMERAL) |
    Number(MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS) |
    Number(MessageFlags.FLAGS.IS_VOICE_MESSAGE) |
    Number(MessageFlags.FLAGS.IS_COMPONENTS_V2);
const EPHEMERAL = Number(MessageFlags.FLAGS.EPHEMERAL);
const LOADING = Number(MessageFlags.FLAGS.LOADING);

const messageRelations = {
    author: true,
    webhook: true,
    application: true,
    mentions: true,
    mention_roles: true,
    mention_channels: true,
    sticker_items: true,
    attachments: true,
} as const;

function resolveComponentMedia(components: unknown, attachments: Attachment[]) {
    const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const record = node as Record<string, unknown>;
        for (const key of ["media", "file"]) {
            const media = record[key] as { url?: string } | undefined;
            if (!media?.url?.startsWith("attachment://")) continue;
            const attachment = attachments.find((a) => a.filename === media.url!.slice("attachment://".length));
            if (!attachment) continue;
            const json = attachment.toJSON();
            Object.assign(media, {
                id: attachment.id,
                url: json.url,
                proxy_url: json.proxy_url,
                width: attachment.width ?? undefined,
                height: attachment.height ?? undefined,
                content_type: attachment.content_type ?? undefined,
                attachment_id: attachment.id,
            });
            if (key === "file") Object.assign(record, { name: attachment.filename, size: attachment.size });
        }
        Object.values(record).forEach(visit);
    };
    visit(components);
}

export function interactionTarget(interaction: Pick<PendingInteraction, "sessionId" | "userId">) {
    return interaction.sessionId ? { session_id: interaction.sessionId } : { user_id: interaction.userId };
}

export async function emitInteractionSuccess(interaction: PendingInteraction) {
    await emitEvent({
        event: "INTERACTION_SUCCESS",
        ...interactionTarget(interaction),
        data: { id: interaction.id, nonce: interaction.nonce ?? "" },
    } satisfies InteractionSuccessEvent);
}

export async function emitInteractionFailure(interaction: Pick<PendingInteraction, "id" | "nonce" | "sessionId" | "userId">, reason = InteractionFailureReason.TIMEOUT) {
    await emitEvent({
        event: "INTERACTION_FAILURE",
        ...interactionTarget(interaction),
        data: { id: interaction.id, nonce: interaction.nonce, reason_code: reason },
    } satisfies InteractionFailureEvent);
}

export async function fetchInteractionMessage(id: string) {
    return Message.findOne({ where: { id, flags: undefined }, relations: messageRelations });
}

async function emitToAudience(message: Message, event: "MESSAGE_CREATE" | "MESSAGE_UPDATE", userId: string) {
    const ephemeral = (message.flags & EPHEMERAL) !== 0;
    await emitEvent({
        event,
        ...(ephemeral ? { user_id: userId } : { channel_id: message.channel_id }),
        data: message.toJSON(),
    } as MessageCreateEvent | MessageUpdateEvent);
}

export async function buildResolved(
    options: { type: number; value?: unknown; options?: unknown[] }[] | undefined,
    guildId: string | undefined,
    channelId: string,
    extra: { users?: string[]; messages?: string[] } = {},
) {
    const users = new Set(extra.users ?? []);
    const roles = new Set<string>();
    const channels = new Set<string>();
    const walk = (list: typeof options) => {
        for (const option of list ?? []) {
            if (option.options) walk(option.options as typeof options);
            const value = option.value as string | undefined;
            if (!value) continue;
            if (option.type === ApplicationCommandOptionType.USER) users.add(value);
            if (option.type === ApplicationCommandOptionType.ROLE) roles.add(value);
            if (option.type === ApplicationCommandOptionType.CHANNEL) channels.add(value);
            if (option.type === ApplicationCommandOptionType.MENTIONABLE) {
                users.add(value);
                roles.add(value);
            }
        }
    };
    walk(options);

    const resolved: Record<string, Record<string, unknown>> = {};
    if (users.size) {
        const found = await User.find({ where: { id: In([...users]) } });
        if (found.length) resolved.users = Object.fromEntries(found.map((u) => [u.id, u.toPublicUser()]));
        if (guildId && found.length) {
            const members = await Member.find({ where: { guild_id: guildId, id: In(found.map((u) => u.id)) }, relations: { roles: true } });
            if (members.length)
                resolved.members = Object.fromEntries(
                    await Promise.all(
                        members.map(async (m) => {
                            const { user, ...rest } = m.toPublicMember();
                            void user;
                            return [m.id, { ...rest, permissions: (await getPermission(m.id, guildId, channelId)).bitfield.toString() }];
                        }),
                    ),
                );
        }
    }
    if (roles.size && guildId) {
        const found = await Role.find({ where: { guild_id: guildId, id: In([...roles]) } });
        if (found.length) resolved.roles = Object.fromEntries(found.map((r) => [r.id, r]));
    }
    if (channels.size) {
        const found = await Channel.find({ where: { id: In([...channels]) } });
        if (found.length)
            resolved.channels = Object.fromEntries(
                found.map((c) => [
                    c.id,
                    { id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, guild_id: c.guild_id, nsfw: c.nsfw, position: c.position, flags: c.flags },
                ]),
            );
    }
    if (extra.messages?.length) {
        const found = await Message.find({ where: { id: In(extra.messages) }, relations: messageRelations });
        if (found.length) resolved.messages = Object.fromEntries(found.map((m) => [m.id, m.toJSON()]));
    }
    return Object.keys(resolved).length ? resolved : undefined;
}

async function interactionMetadata(interaction: PendingInteraction, extra: Record<string, unknown> = {}) {
    const user = await User.findOneOrFail({ where: { id: interaction.userId } });
    const targetUserId = [interaction, interaction.triggeringInteraction].find((i) => i?.commandType === ApplicationCommandType.USER)?.targetId;
    const targetUser = targetUserId ? (await User.findOne({ where: { id: targetUserId } }))?.toPublicUser() : undefined;
    const base = (i: Omit<PendingInteraction, "expires" | "timeout" | "triggeringInteraction">) => ({
        id: i.id,
        type: i.type,
        user: user.toPublicUser(),
        user_id: i.userId,
        authorizing_integration_owners: i.authorizingOwners,
        ...(i.type === InteractionType.ApplicationCommand && {
            name: i.commandName,
            command_type: i.commandType,
            ...(i.commandType === ApplicationCommandType.USER && i.targetId && { target_user: targetUser }),
            ...(i.commandType === ApplicationCommandType.MESSAGE && i.targetId && { target_message_id: i.targetId }),
        }),
        ...(i.type === InteractionType.MessageComponent && { interacted_message_id: i.messageId }),
    });
    return {
        ...base(interaction),
        ...(interaction.triggeringInteraction && { triggering_interaction_metadata: base(interaction.triggeringInteraction) }),
        ...extra,
    };
}

function messageTypeFor(interaction: PendingInteraction) {
    const origin = interaction.type === InteractionType.ModalSubmit && interaction.triggeringInteraction ? interaction.triggeringInteraction : interaction;
    if (origin.type === InteractionType.ApplicationCommand) {
        if (origin.commandType === ApplicationCommandType.USER || origin.commandType === ApplicationCommandType.MESSAGE) return { type: MessageType.CONTEXT_MENU_COMMAND, origin };
        return { type: MessageType.APPLICATION_COMMAND, origin };
    }
    return { type: MessageType.REPLY, origin };
}

export async function createInteractionMessage(interaction: PendingInteraction, data: InteractionMessage = {}, opts: { loading?: boolean; followup?: boolean } = {}) {
    let flags = (data.flags ?? 0) & SETTABLE_FLAGS;
    if (interaction.forceEphemeral) flags |= EPHEMERAL;
    if (opts.loading) flags |= LOADING;
    const ephemeral = (flags & EPHEMERAL) !== 0;

    if (!opts.loading && !data.content && !data.embeds?.length && !data.components?.length && !data.attachments?.length && !data.poll)
        throw new HTTPError("Cannot send an empty message", 400);
    if (data.content && data.content.length > Config.get().limits.message.maxCharacters) throw new HTTPError("Content length over max character limit", 400);

    const { type, origin } = messageTypeFor(interaction);
    const referenceId = type === MessageType.REPLY ? origin.messageId : origin.commandType === ApplicationCommandType.MESSAGE ? origin.targetId : undefined;
    const referenced = referenceId ? await Message.findOne({ where: { id: referenceId } }) : null;

    const user = await User.findOneOrFail({ where: { id: interaction.userId } });
    const message = await handleMessage({
        type,
        timestamp: new Date(),
        application_id: interaction.applicationId,
        channel_id: interaction.channelId,
        author_id: interaction.applicationId,
        nonce: opts.followup ? undefined : interaction.nonce,
        content: data.content ?? "",
        components: (data.components as BaseMessageComponents[]) ?? [],
        tts: data.tts,
        embeds: data.embeds ?? [],
        attachments: data.attachments,
        poll: data.poll,
        flags,
        reactions: [],
        allowed_mentions: data.allowed_mentions as never,
        message_reference: referenced ? { message_id: referenced.id, channel_id: referenced.channel_id, guild_id: referenced.guild_id ?? undefined } : undefined,
        interaction:
            origin.type === InteractionType.ApplicationCommand
                ? ({
                      id: origin.id,
                      type: origin.type,
                      name: origin.commandName ?? "",
                      user: user.toPublicUser(),
                      command_id: origin.commandId,
                      options: origin.commandOptions,
                  } as never)
                : undefined,
        interaction_metadata: (await interactionMetadata(
            interaction,
            opts.followup && interaction.responseMessageId ? { original_response_message_id: interaction.responseMessageId } : {},
        )) as never,
    });
    message.type = type;
    resolveComponentMedia(message.components, message.attachments ?? []);
    if (referenced?.author_id && !message.content?.match(new RegExp(`<@!?${referenced.author_id}>`)))
        message.mentions = message.mentions.filter((u) => u.id !== referenced.author_id);
    if (!referenced) {
        message.message_reference = undefined;
        message.referenced_message = undefined;
    }

    await message.save();
    if (message.attachments?.length) await Promise.all(message.attachments.map((a) => a.save()));
    await emitToAudience(message, "MESSAGE_CREATE", interaction.userId);
    if (!ephemeral) postHandleMessage(message).catch((e) => console.error("[Interaction] post-message handler failed", e));
    return message;
}

export async function editInteractionMessage(interaction: PendingInteraction, message: Message, data: InteractionMessage & { content?: string | null }) {
    if (data.content && data.content.length > Config.get().limits.message.maxCharacters) throw new HTTPError("Content length over max character limit", 400);
    const wasLoading = (message.flags & LOADING) !== 0;

    if (data.content !== undefined) message.content = data.content ?? "";
    if (data.embeds !== undefined) message.embeds = data.embeds ?? [];
    if (data.components !== undefined) {
        const flags = data.flags ?? message.flags;
        if (data.components) handleComps(data.components, flags);
        message.components = data.components ?? [];
        resolveComponentMedia(message.components, message.attachments ?? []);
    }
    if (data.poll !== undefined) message.poll = data.poll as never;
    if (data.flags !== undefined) message.flags = (message.flags & (EPHEMERAL | LOADING)) | (data.flags & SETTABLE_FLAGS & ~EPHEMERAL);
    if (data.attachments !== undefined && data.attachments.length === 0) message.attachments = [];

    message.flags &= ~LOADING;
    if (!wasLoading) message.edited_timestamp = new Date();
    await message.save();
    await emitToAudience(message, "MESSAGE_UPDATE", interaction.userId);
    return message;
}

export async function deleteInteractionMessage(interaction: PendingInteraction, message: Message) {
    await Message.delete({ id: message.id });
    const ephemeral = (message.flags & EPHEMERAL) !== 0;
    await emitEvent({
        event: "MESSAGE_DELETE",
        ...(ephemeral ? { user_id: interaction.userId } : { channel_id: message.channel_id }),
        data: { id: message.id, channel_id: message.channel_id!, guild_id: message.guild_id ?? undefined },
    } satisfies MessageDeleteEvent);
}

export function messageBelongsToInteraction(interaction: PendingInteraction, message: Message | null): message is Message {
    if (!message) return false;
    const metadata = message.interaction_metadata as { id?: string } | undefined;
    return message.channel_id === interaction.channelId && message.application_id === interaction.applicationId && metadata?.id === interaction.id;
}

export async function processInteractionCallback(interaction: PendingInteraction, body: InteractionCallbacksSchema, files: Express.Multer.File[] = []) {
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

    return {
        interaction: {
            id: interaction.id,
            type: interaction.type,
            response_message_id: interaction.responseMessageId,
            response_message_loading: interaction.responseLoading ?? false,
            response_message_ephemeral: interaction.responseEphemeral ?? false,
        },
        resource: {
            type: body.type,
            message: message?.toJSON(),
        },
    };
}
