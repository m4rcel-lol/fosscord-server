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
import { In, IsNull } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Application, ApplicationCommand, ApplicationCommandPermission, ApplicationCommandPermissionOverwrite, Member } from "@spacebar/database";
import { ApplicationCommandCreateSchema, ApplicationCommandType } from "@spacebar/schemas";
import { ApiError, DiscordApiErrors, emitEvent, FieldErrors, getPermission, Snowflake } from "@spacebar/util";

const NAME_PATTERN = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

export async function assertCanManageCommands(req: Request) {
    const application = await Application.findOne({ where: { id: req.params.application_id as string } });
    if (!application) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (req.user_id !== application.id && req.user_id !== application.owner_id) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
    const guildId = req.params.guild_id as string | undefined;
    if (guildId && !(await Member.exists({ where: { guild_id: guildId, id: application.id } }))) throw DiscordApiErrors.MISSING_ACCESS;
    return application;
}

export function serializeCommand(command: ApplicationCommand) {
    const type = command.type ?? ApplicationCommandType.CHAT_INPUT;
    return {
        id: command.id,
        application_id: command.application_id,
        version: String(command.version),
        default_member_permissions: command.default_member_permissions ?? null,
        type,
        name: command.name,
        name_localizations: command.name_localizations ?? null,
        description: command.description,
        description_localizations: command.description_localizations ?? null,
        ...(command.guild_id ? { guild_id: command.guild_id } : { dm_permission: command.dm_permission ?? true }),
        ...(type === ApplicationCommandType.CHAT_INPUT && { options: command.options ?? [] }),
        contexts: command.contexts ?? null,
        integration_types: command.integration_types ?? [0],
        nsfw: command.nsfw ?? false,
        ...(type === ApplicationCommandType.PRIMARY_ENTRY_POINT && { handler: command.handler }),
    };
}

function validate(body: ApplicationCommandCreateSchema, path = "") {
    const type = body.type ?? ApplicationCommandType.CHAT_INPUT;
    const name = body.name?.trim() ?? "";
    const errors: Record<string, { code: string; message: string }> = {};
    if (!NAME_PATTERN.test(name) && type === ApplicationCommandType.CHAT_INPUT)
        errors[`${path}name`] = { code: "APPLICATION_COMMAND_INVALID_NAME", message: `Command name is invalid` };
    if (type === ApplicationCommandType.CHAT_INPUT && name !== name.toLowerCase())
        errors[`${path}name`] = { code: "APPLICATION_COMMAND_INVALID_NAME", message: "Command name is invalid" };
    if (name.length < 1 || name.length > 32) errors[`${path}name`] = { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 1 and 32 in length." };
    const description = body.description?.trim() ?? "";
    if (type === ApplicationCommandType.CHAT_INPUT && (description.length < 1 || description.length > 100))
        errors[`${path}description`] = { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 1 and 100 in length." };
    if (type !== ApplicationCommandType.CHAT_INPUT && description)
        errors[`${path}description`] = { code: "APPLICATION_COMMAND_INVALID_DESCRIPTION", message: "Context menu commands cannot have description" };
    if ((body.options?.length ?? 0) > 25) errors[`${path}options`] = { code: "BASE_TYPE_MAX_LENGTH", message: "Must be 25 or fewer in length." };
    if (Object.keys(errors).length) throw FieldErrors(errors);
    return { type, name, description };
}

function apply(command: ApplicationCommand, body: ApplicationCommandCreateSchema, applicationId: string, guildId: string | undefined) {
    const { type, name, description } = validate({ ...serializeIfExisting(command), ...body } as ApplicationCommandCreateSchema);
    command.assign({
        application_id: applicationId,
        guild_id: guildId,
        type,
        name,
        description,
        name_localizations: body.name_localizations ?? command.name_localizations,
        description_localizations: body.description_localizations ?? command.description_localizations,
        options: type === ApplicationCommandType.CHAT_INPUT ? (body.options ?? command.options ?? []) : [],
        default_member_permissions: body.default_member_permissions !== undefined ? (body.default_member_permissions ?? null) : (command.default_member_permissions ?? null),
        dm_permission: body.dm_permission ?? command.dm_permission ?? true,
        nsfw: body.nsfw ?? command.nsfw ?? false,
        integration_types: body.integration_types ?? command.integration_types,
        contexts: body.contexts ?? command.contexts,
        handler: body.handler ?? command.handler ?? 0,
        version: Snowflake.generate(),
    });
    return command;
}

function serializeIfExisting(command: ApplicationCommand) {
    return command.id ? { type: command.type, name: command.name, description: command.description } : {};
}

async function upsert(applicationId: string, guildId: string | undefined, body: ApplicationCommandCreateSchema) {
    const type = body.type ?? ApplicationCommandType.CHAT_INPUT;
    const existing = await ApplicationCommand.findOne({ where: { application_id: applicationId, guild_id: guildId ?? IsNull(), name: body.name?.trim(), type } });
    const command = apply(existing ?? ApplicationCommand.create({ id: Snowflake.generate() }), body, applicationId, guildId);
    await command.save();
    return { command, created: !existing };
}

export async function emitCommandIndexUpdate(applicationId: string, guildId?: string) {
    const guildIds = guildId ? [guildId] : (await Member.find({ where: { id: applicationId }, select: { guild_id: true } })).map((m) => m.guild_id);
    await Promise.all(
        guildIds.map(async (id) => {
            const members = await Member.find({ where: { guild_id: id, user: { bot: true } }, select: { id: true } });
            const commands = members.length
                ? await ApplicationCommand.find({
                      where: members.flatMap((m) => [
                          { application_id: m.id, guild_id: IsNull() },
                          { application_id: m.id, guild_id: id },
                      ]),
                      select: { type: true },
                  })
                : [];
            const counts = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
            for (const c of commands) counts[c.type ?? 1] = (counts[c.type ?? 1] ?? 0) + 1;
            await emitEvent({
                event: "GUILD_APPLICATION_COMMAND_INDEX_UPDATE",
                guild_id: id,
                data: { guild_id: id, application_command_counts: counts, version: Snowflake.generate() },
            });
        }),
    );
}

function indexPermissions(overwrites: ApplicationCommandPermissionOverwrite[] | undefined, userId?: string) {
    if (!overwrites?.length) return undefined;
    const user = overwrites.find((o) => o.type === 2 && o.id === userId)?.permission;
    const roles = Object.fromEntries(overwrites.filter((o) => o.type === 1).map((o) => [o.id, o.permission]));
    const channels = Object.fromEntries(overwrites.filter((o) => o.type === 3).map((o) => [o.id, o.permission]));
    return {
        ...(user !== undefined && { user }),
        ...(Object.keys(roles).length && { roles }),
        ...(Object.keys(channels).length && { channels }),
    };
}

export async function buildCommandIndex(applicationIds: string[], scope: { guildId?: string; context?: number; integrationType?: number; userId?: string }) {
    if (!applicationIds.length) return { applications: [], application_commands: [], version: "0" };
    const applications = await Application.find({ where: { id: In(applicationIds) }, relations: { bot: true } });
    const commands = applications.length
        ? await ApplicationCommand.find({
              where: applications.flatMap((a) => [{ application_id: a.id, guild_id: IsNull() }, ...(scope.guildId ? [{ application_id: a.id, guild_id: scope.guildId }] : [])]),
              order: { id: "ASC" },
          })
        : [];
    const visible = commands.filter((c) => {
        if (scope.integrationType !== undefined && !(c.integration_types?.length ? c.integration_types : [0]).includes(scope.integrationType)) return false;
        if (c.guild_id || scope.context === undefined) return true;
        if (c.contexts?.length) return c.contexts.includes(scope.context);
        return scope.context !== 1 || c.dm_permission !== false;
    });
    const overwrites =
        scope.guildId && applications.length
            ? await ApplicationCommandPermission.find({ where: { guild_id: scope.guildId, application_id: In(applications.map((a) => a.id)) } })
            : [];
    const overwritesFor = (id: string) => indexPermissions(overwrites.find((o) => o.id === id)?.permissions, scope.userId);
    return {
        applications: applications.map((a) => ({
            id: a.id,
            permissions: overwritesFor(a.id),
            name: a.name,
            description: a.description ?? "",
            icon: a.icon ?? null,
            flags: a.flags ?? 0,
            bot_id: a.bot?.id,
            bot: a.bot?.toPublicUser(),
        })),
        application_commands: visible.map((c) => ({ ...serializeCommand(c), guild_id: c.guild_id ?? undefined, permissions: overwritesFor(c.id) })),
        version: visible.reduce((v, c) => (BigInt(c.version) > BigInt(v) ? String(c.version) : v), "0"),
    };
}

export async function canUseCommand(command: ApplicationCommand, guildId: string, userId: string, roleIds: string[], channelId: string) {
    const rows = await ApplicationCommandPermission.find({ where: { guild_id: guildId, id: In([command.id, command.application_id]) } });
    const merged = new Map<string, ApplicationCommandPermissionOverwrite>();
    for (const o of rows.find((r) => r.id === command.application_id)?.permissions ?? []) merged.set(`${o.type}:${o.id}`, o);
    for (const o of rows.find((r) => r.id === command.id)?.permissions ?? []) merged.set(`${o.type}:${o.id}`, o);
    const overwrites = [...merged.values()];
    const allChannels = (BigInt(guildId) - 1n).toString();
    const channel = overwrites.find((o) => o.type === 3 && o.id === channelId) ?? overwrites.find((o) => o.type === 3 && o.id === allChannels);
    const user = overwrites.find((o) => o.type === 2 && o.id === userId);
    const roles = overwrites.filter((o) => o.type === 1 && o.id !== guildId && roleIds.includes(o.id));
    const everyone = overwrites.find((o) => o.type === 1 && o.id === guildId);
    const explicit = user ? user.permission : roles.length ? roles.some((r) => r.permission) : undefined;
    const member = explicit ?? everyone?.permission ?? true;
    return { allowed: (channel?.permission ?? true) && member, explicit: explicit === true };
}

async function assertCanReadPermissions(req: Request) {
    const applicationId = req.params.application_id as string;
    const guildId = req.params.guild_id as string;
    if (!(await Member.exists({ where: { guild_id: guildId, id: applicationId } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (req.user_id === applicationId) return;
    const permission = await getPermission(req.user_id, guildId);
    permission.hasThrow("MANAGE_GUILD");
}

export function commandPermissionsListRouter() {
    const router = Router({ mergeParams: true });
    router.get("/", route({ oauth2: ["applications.commands.permissions.update"] }), async (req: Request, res: Response) => {
        await assertCanReadPermissions(req);
        const rows = await ApplicationCommandPermission.find({ where: { guild_id: req.params.guild_id as string, application_id: req.params.application_id as string } });
        res.json(rows.map((r) => r.toJSON()));
    });
    return router;
}

export function commandPermissionsRouter() {
    const router = Router({ mergeParams: true });
    const target = async (req: Request) => {
        const applicationId = req.params.application_id as string;
        const guildId = req.params.guild_id as string;
        const commandId = req.params.command_id as string;
        if (!/^\d+$/.test(commandId)) throw DiscordApiErrors.UNKNOWN_APPLICATION_COMMAND;
        if (commandId !== applicationId) {
            const exists = await ApplicationCommand.exists({
                where: [
                    { id: commandId, application_id: applicationId, guild_id: IsNull() },
                    { id: commandId, application_id: applicationId, guild_id: guildId },
                ],
            });
            if (!exists) throw DiscordApiErrors.UNKNOWN_APPLICATION_COMMAND;
        }
        return { applicationId, guildId, commandId };
    };

    router.get("/", route({ oauth2: ["applications.commands.permissions.update"] }), async (req: Request, res: Response) => {
        await assertCanReadPermissions(req);
        const { guildId, commandId } = await target(req);
        const row = await ApplicationCommandPermission.findOne({ where: { id: commandId, guild_id: guildId } });
        if (!row) throw new ApiError("Unknown application command permissions", 10066, 404);
        res.json(row.toJSON());
    });

    router.put(
        "/",
        route({ requestBody: "ApplicationCommandPermissionsUpdateSchema", oauth2: ["applications.commands.permissions.update"] }),
        async (req: Request, res: Response) => {
            const { applicationId, guildId, commandId } = await target(req);
            if (!(await Member.exists({ where: { guild_id: guildId, id: applicationId } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
            const permission = await getPermission(req.user_id, guildId);
            permission.hasThrow("MANAGE_GUILD");
            permission.hasThrow("MANAGE_ROLES");
            const body = req.body as { permissions: ApplicationCommandPermissionOverwrite[] };
            if (body.permissions.length > 100) throw FieldErrors({ permissions: { code: "BASE_TYPE_MAX_LENGTH", message: "Must be 100 or fewer in length." } });
            const row = ApplicationCommandPermission.create({ id: commandId, guild_id: guildId, application_id: applicationId, permissions: body.permissions });
            if (body.permissions.length) await row.save();
            else await ApplicationCommandPermission.delete({ id: commandId, guild_id: guildId });
            await emitEvent({ event: "APPLICATION_COMMAND_PERMISSIONS_UPDATE", guild_id: guildId, data: row.toJSON() });
            res.json(row.toJSON());
        },
    );

    return router;
}

export function commandListRouter() {
    const router = Router({ mergeParams: true });

    router.get(
        "/",
        route({ query: { with_localizations: { type: "boolean", required: false } }, oauth2: ["applications.commands", "applications.commands.update"] }),
        async (req: Request, res: Response) => {
            const application = await assertCanManageCommands(req);
            const commands = await ApplicationCommand.find({
                where: { application_id: application.id, guild_id: (req.params.guild_id as string) ?? IsNull() },
                order: { id: "ASC" },
            });
            res.json(commands.map(serializeCommand));
        },
    );

    router.post("/", route({ requestBody: "ApplicationCommandCreateSchema", oauth2: ["applications.commands.update"] }), async (req: Request, res: Response) => {
        const application = await assertCanManageCommands(req);
        const { command, created } = await upsert(application.id, req.params.guild_id as string | undefined, req.body as ApplicationCommandCreateSchema);
        await emitCommandIndexUpdate(application.id, req.params.guild_id as string | undefined);
        res.status(created ? 201 : 200).json(serializeCommand(command));
    });

    router.put("/", route({ requestBody: "BulkApplicationCommandCreateSchema", oauth2: ["applications.commands.update"] }), async (req: Request, res: Response) => {
        const application = await assertCanManageCommands(req);
        const guildId = req.params.guild_id as string | undefined;
        const body = req.body as ApplicationCommandCreateSchema[];
        if (body.length > 110) throw FieldErrors({ _errors: { code: "BASE_TYPE_MAX_LENGTH", message: "Must be 110 or fewer in length." } });
        body.forEach((c, i) => validate(c, `${i}.`));
        const keep = new Set(body.map((c) => `${c.type ?? ApplicationCommandType.CHAT_INPUT}:${c.name.trim()}`));
        const existing = await ApplicationCommand.find({ where: { application_id: application.id, guild_id: guildId ?? IsNull() } });
        const stale = existing.filter((c) => !keep.has(`${c.type ?? ApplicationCommandType.CHAT_INPUT}:${c.name}`));
        if (stale.length) await ApplicationCommand.delete(stale.map((c) => c.id));
        const saved = [];
        for (const c of body) saved.push((await upsert(application.id, guildId, c)).command);
        await emitCommandIndexUpdate(application.id, guildId);
        res.json(saved.map(serializeCommand));
    });

    return router;
}

export function commandRouter() {
    const router = Router({ mergeParams: true });

    const find = async (req: Request) => {
        const application = await assertCanManageCommands(req);
        const command = await ApplicationCommand.findOne({
            where: { application_id: application.id, id: req.params.command_id as string, guild_id: (req.params.guild_id as string) ?? IsNull() },
        });
        if (!command) throw DiscordApiErrors.UNKNOWN_APPLICATION_COMMAND;
        return { application, command };
    };

    router.get("/", route({ oauth2: ["applications.commands", "applications.commands.update"] }), async (req: Request, res: Response) => {
        const { command } = await find(req);
        res.json(serializeCommand(command));
    });

    router.patch("/", route({ requestBody: "ApplicationCommandModifySchema", oauth2: ["applications.commands.update"] }), async (req: Request, res: Response) => {
        const { application, command } = await find(req);
        const body = req.body as Partial<ApplicationCommandCreateSchema>;
        apply(command, { ...body, name: body.name ?? command.name, type: command.type } as ApplicationCommandCreateSchema, application.id, command.guild_id ?? undefined);
        await command.save();
        await emitCommandIndexUpdate(application.id, command.guild_id ?? undefined);
        res.json(serializeCommand(command));
    });

    router.delete("/", route({ oauth2: ["applications.commands.update"] }), async (req: Request, res: Response) => {
        const { application, command } = await find(req);
        await ApplicationCommand.delete({ id: command.id });
        await emitCommandIndexUpdate(application.id, command.guild_id ?? undefined);
        res.sendStatus(204);
    });

    return router;
}
