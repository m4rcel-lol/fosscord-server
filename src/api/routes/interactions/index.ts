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

import { randomBytes } from "node:crypto";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import {
    ajv,
    InteractionCallbacksSchema,
    InteractionSchema,
    InteractionType,
    ApplicationCommandType,
    ApplicationCommandHandlerType,
    ChannelType,
    InteractionFailureReason,
    MessageCreateCloudAttachment,
    PublicAttachment,
} from "@spacebar/schemas";
import { route } from "@spacebar/api/middlewares";
import { Application, ApplicationAuthorization, ApplicationCommand, Channel, Guild, Member, Session } from "@spacebar/database";
import {
    Config,
    DiscordApiErrors,
    emitEvent,
    getPermission,
    InteractionCreateEvent,
    InteractionSuccessEvent,
    PendingInteraction,
    pendingInteractions,
    Permissions,
    Snowflake,
    storeInteraction,
} from "@spacebar/util";
import { buildResolved, emitInteractionFailure, fetchInteractionMessage, interactionTarget, processInteractionCallback } from "@spacebar/api/util/handlers/Interaction";
import { launchActivity } from "@spacebar/api/activities";
import { ensureInteractionKeys, postSignedInteraction } from "@spacebar/api/util/handlers/Application";
import { convertCloudAttachmentToAttachment } from "@spacebar/api/util";
import { canUseCommand } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

function deliverOverHttp(applicationId: string, url: string, interaction: PendingInteraction, payload: unknown) {
    (async () => {
        const key = await ensureInteractionKeys(applicationId);
        const res = await postSignedInteraction(url, key, payload);
        if (!res.ok) throw new Error(`endpoint returned ${res.status}`);
        const callback = (await res.json()) as InteractionCallbacksSchema;
        const validate = ajv.getSchema("InteractionCallbacksSchema");
        if (validate && !validate(callback)) throw new Error("endpoint returned an invalid interaction response");
        if (interaction.acknowledged) return;
        await processInteractionCallback(interaction, callback);
    })().catch((error) => {
        console.error(`[Interactions] HTTP delivery to ${url} failed:`, error?.message ?? error);
        if (!interaction.acknowledged) {
            clearTimeout(interaction.timeout);
            emitInteractionFailure(interaction);
        }
    });
}

router.post("/", route({}), async (req: Request, res: Response) => {
    const body = req.body as InteractionSchema & { data: Record<string, unknown> };
    const data = (body.data ?? {}) as Record<string, unknown> & { options?: { type: number; value?: unknown }[] };

    if (body.type === InteractionType.ApplicationCommand && typeof data.id === "string") {
        const entryPoint = await ApplicationCommand.findOne({
            where: {
                id: data.id,
                application_id: body.application_id,
                type: ApplicationCommandType.PRIMARY_ENTRY_POINT,
                handler: ApplicationCommandHandlerType.DISCORD_LAUNCH_ACTIVITY,
            },
        });
        if (entryPoint) {
            const interaction = { id: Snowflake.generate(), nonce: body.nonce, userId: req.user_id, sessionId: body.session_id };
            const target = interactionTarget(interaction);
            await emitEvent({ event: "INTERACTION_CREATE", ...target, data: { id: interaction.id, nonce: body.nonce } } satisfies InteractionCreateEvent);
            try {
                await launchActivity({ userId: req.user_id, applicationId: entryPoint.application_id, channelId: body.channel_id, sessionId: body.session_id, nonce: body.nonce });
            } catch (error) {
                const code = (error as { code?: number }).code;
                const reasons: Record<number, InteractionFailureReason> = {
                    10002: InteractionFailureReason.ACTIVITY_LAUNCH_UNKNOWN_APPLICATION,
                    10003: InteractionFailureReason.ACTIVITY_LAUNCH_UNKNOWN_CHANNEL,
                    50013: InteractionFailureReason.ACTIVITY_LAUNCH_INVALID_USER_PERMISSIONS,
                    50024: InteractionFailureReason.ACTIVITY_LAUNCH_INVALID_CHANNEL_TYPE,
                };
                await emitInteractionFailure(interaction, (code && reasons[code]) || InteractionFailureReason.ACTIVITY_LAUNCH_FAILED_TO_LAUNCH);
                return res.sendStatus(204);
            }
            await emitEvent({ event: "INTERACTION_SUCCESS", ...target, data: { id: interaction.id, nonce: body.nonce ?? "" } } satisfies InteractionSuccessEvent);
            return res.sendStatus(204);
        }
    }

    const application = await Application.findOne({ where: { id: body.application_id }, relations: { bot: true } });
    if (!application?.bot) throw DiscordApiErrors.UNKNOWN_APPLICATION;

    const channel = await Channel.findOne({ where: { id: body.channel_id }, relations: { recipients: true } });
    if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    const guildId = channel.guild_id ?? undefined;

    const permission = await getPermission(req.user_id, guildId, channel);
    permission.hasThrow("VIEW_CHANNEL");
    if (guildId && body.type !== InteractionType.MessageComponent && body.type !== InteractionType.ModalSubmit) permission.hasThrow("USE_APPLICATION_COMMANDS");

    const guildInstalled = guildId ? await Member.exists({ where: { guild_id: guildId, id: application.id } }) : false;
    const userInstalled = await ApplicationAuthorization.exists({ where: { user_id: req.user_id, application_id: application.id, integration_type: 1 } });
    const botDm = !guildId && channel.type === ChannelType.DM && !!channel.recipients?.some((r) => r.user_id === application.id);
    const context = guildId ? 0 : botDm ? 1 : 2;
    const authorizingOwners: Record<string, string> = {
        ...(guildInstalled && guildId && { "0": guildId }),
        ...(botDm && { "0": "0" }),
        ...(userInstalled && { "1": req.user_id }),
    };
    if (!Object.keys(authorizingOwners).length) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const forceEphemeral = !!guildId && !guildInstalled && !permission.has("USE_EXTERNAL_APPS");

    const interactionId = Snowflake.generate();
    const token = Buffer.from(`interaction:${interactionId}:${randomBytes(48).toString("hex")}`).toString("base64url");

    const triggering = body.type === InteractionType.ModalSubmit ? pendingInteractions.get(data.id as string) : undefined;
    if (body.type === InteractionType.ModalSubmit && (!triggering || triggering.userId !== req.user_id)) throw DiscordApiErrors.UNKNOWN_INTERACTION;

    let botData: Record<string, unknown> | undefined;
    let command: ApplicationCommand | null = null;
    const messageId = body.type === InteractionType.MessageComponent ? body.message_id : triggering?.messageId;
    const message = messageId ? await fetchInteractionMessage(messageId) : null;
    if (messageId && (!message || message.channel_id !== channel.id || message.application_id !== application.id)) throw DiscordApiErrors.UNKNOWN_MESSAGE;

    switch (body.type) {
        case InteractionType.ApplicationCommand:
        case InteractionType.ApplicationCommandAutocomplete: {
            command = await ApplicationCommand.findOne({ where: { id: data.id as string, application_id: application.id } });
            if (!command || (command.guild_id && command.guild_id !== guildId)) throw DiscordApiErrors.UNKNOWN_APPLICATION_COMMAND;
            const integrationTypes = command.integration_types?.length ? command.integration_types : [0];
            const contexts = command.contexts?.length ? command.contexts : command.dm_permission === false ? [0] : [0, 1, 2];
            const usable = contexts.includes(context) && ((integrationTypes.includes(0) && (guildInstalled || botDm)) || (integrationTypes.includes(1) && userInstalled));
            if (!usable) throw DiscordApiErrors.UNKNOWN_APPLICATION_COMMAND;
            const access =
                guildId && guildInstalled && !permission.has("ADMINISTRATOR")
                    ? await canUseCommand(command, guildId, req.user_id, permission.cache.roles?.map((r) => r.id) ?? [], channel.id)
                    : undefined;
            if (access && !access.allowed) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("application command permissions");
            if (guildId && guildInstalled && !access?.explicit && command.default_member_permissions != null && !permission.has("ADMINISTRATOR")) {
                const required = BigInt(command.default_member_permissions);
                if (required === 0n || (permission.bitfield & required) !== required) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("default_member_permissions");
            }
            const targetId = data.target_id as string | undefined;
            const uploads = (data.attachments ?? []) as MessageCreateCloudAttachment[];
            const attachments: Record<string, PublicAttachment & { id: string }> = {};
            for (const upload of uploads) {
                const id = Snowflake.generate();
                const attachment = await convertCloudAttachmentToAttachment(upload, channel.id, id);
                attachment.id = id;
                attachments[upload.id as string] = { ...attachment.toJSON(), id };
            }
            const remap = (options?: { type: number; value?: unknown; options?: unknown[] }[]) =>
                options?.forEach((o) => {
                    if (o.type === 11 && attachments[o.value as string]) o.value = attachments[o.value as string].id;
                    remap(o.options as never);
                });
            remap(data.options);
            botData = {
                id: command.id,
                name: command.name,
                type: command.type ?? ApplicationCommandType.CHAT_INPUT,
                guild_id: command.guild_id ?? undefined,
                options: data.options,
                target_id: targetId,
                resolved: await buildResolved(data.options, guildId, channel.id, {
                    users: command.type === ApplicationCommandType.USER && targetId ? [targetId] : [],
                    messages: command.type === ApplicationCommandType.MESSAGE && targetId ? [targetId] : [],
                }).then((resolved) =>
                    Object.keys(attachments).length ? { ...resolved, attachments: Object.fromEntries(Object.values(attachments).map((a) => [a.id, a])) } : resolved,
                ),
            };
            break;
        }
        case InteractionType.MessageComponent: {
            const values = data.values as string[] | undefined;
            const componentType = (data.component_type ?? data.type) as number;
            botData = {
                custom_id: data.custom_id,
                component_type: componentType,
                values,
                resolved:
                    values && componentType >= 5 && componentType <= 8
                        ? await buildResolved(
                              values.map((value) => ({ type: componentType === 5 ? 6 : componentType === 6 ? 8 : componentType === 8 ? 7 : 9, value })),
                              guildId,
                              channel.id,
                          )
                        : undefined,
            };
            break;
        }
        case InteractionType.ModalSubmit:
            botData = { custom_id: data.custom_id, components: data.components };
            break;
        default:
            throw new HTTPError("Invalid interaction type", 400);
    }

    const session = body.session_id ? await Session.findOne({ where: { session_id: body.session_id, user_id: req.user_id } }) : null;

    const interaction = storeInteraction({
        id: interactionId,
        token,
        applicationId: application.id,
        userId: req.user_id,
        sessionId: session?.session_id,
        channelId: channel.id,
        guildId,
        nonce: body.nonce,
        messageId: messageId,
        type: body.type,
        commandType: command?.type ?? (command ? ApplicationCommandType.CHAT_INPUT : undefined),
        commandName: command
            ? [
                  command.name,
                  ...(function path(options?: { type: number; name?: string; options?: unknown[] }[]): string[] {
                      const sub = options?.find((o) => o.type === 1 || o.type === 2);
                      return sub ? [sub.name ?? "", ...path(sub.options as never)] : [];
                  })(data.options as never),
              ].join(" ")
            : undefined,
        commandId: command?.id,
        commandOptions: data.options,
        targetId: data.target_id as string | undefined,
        customId: data.custom_id as string | undefined,
        componentType: data.component_type as number | undefined,
        authorizingOwners,
        forceEphemeral,
        triggeringInteraction: triggering
            ? (({ expires, timeout, triggeringInteraction, ...rest }) => {
                  void expires;
                  void timeout;
                  void triggeringInteraction;
                  return rest;
              })(triggering)
            : undefined,
    });

    if (body.type !== InteractionType.ApplicationCommandAutocomplete) {
        await emitEvent({
            event: "INTERACTION_CREATE",
            ...(session ? { session_id: session.session_id } : { user_id: req.user_id }),
            data: { id: interactionId, nonce: body.nonce },
        } satisfies InteractionCreateEvent);
    }

    const guild = guildId ? await Guild.findOne({ where: { id: guildId } }) : null;
    const member = guildId ? await Member.findOne({ where: { guild_id: guildId, id: req.user_id }, relations: { user: true, roles: true } }) : null;
    const appPermissions = await getPermission(application.id, guildId, channel).catch(() => null);

    const payload = {
        id: interactionId,
        application_id: application.id,
        type: body.type,
        data: botData,
        token,
        version: 1,
        channel_id: channel.id,
        channel: {
            id: channel.id,
            type: channel.type,
            name: channel.name ?? undefined,
            guild_id: guildId,
            parent_id: channel.parent_id ?? undefined,
            nsfw: channel.nsfw,
            flags: channel.flags,
            permissions: permission.bitfield.toString(),
            recipients: guildId ? undefined : channel.recipients?.map((r) => ({ id: r.user_id })),
        },
        app_permissions: (appPermissions?.bitfield ?? new Permissions(["SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES", "USE_EXTERNAL_EMOJIS"]).bitfield).toString(),
        locale: req.user?.settings?.locale ?? "en-US",
        entitlements: [],
        entitlement_sku_ids: [],
        authorizing_integration_owners: authorizingOwners,
        context,
        attachment_size_limit: Config.get().cdn.maxAttachmentSize,
        ...(guild && {
            guild_id: guild.id,
            guild: { id: guild.id, features: guild.features, locale: guild.preferred_locale ?? "en-US" },
            guild_locale: guild.preferred_locale ?? "en-US",
        }),
        ...(member ? { member: { ...member.toPublicMember(), permissions: permission.bitfield.toString() } } : { user: req.user.toPublicUser() }),
        ...(message && { message: message.toJSON() }),
    };

    if (application.interactions_endpoint_url) deliverOverHttp(application.id, application.interactions_endpoint_url, interaction, payload);
    else
        await emitEvent({
            event: "INTERACTION_CREATE",
            user_id: application.id,
            data: payload as never,
        } satisfies InteractionCreateEvent);

    interaction.timeout = setTimeout(() => {
        if (interaction.acknowledged) return;
        if (body.type !== InteractionType.ApplicationCommandAutocomplete) emitInteractionFailure(interaction);
    }, 3000);

    res.sendStatus(204);
});

export default router;
