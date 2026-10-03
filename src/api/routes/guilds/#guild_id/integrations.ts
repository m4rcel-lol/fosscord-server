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

import { Router, Response, Request } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Application, AuditLog, Member, Role } from "@spacebar/database";
import { AuditLogEvents } from "@spacebar/schemas";
import { DiscordApiErrors, emitEvent, GuildIntegrationUpdateEvent } from "@spacebar/util";
import { emitCommandIndexUpdate } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const guildId = req.params.guild_id as string;
    const bots = await Member.find({ where: { guild_id: guildId, user: { bot: true } }, select: { id: true, joined_at: true } });
    const applications = bots.length ? await Application.find({ where: { id: In(bots.map((b) => b.id)) }, relations: { bot: true, owner: true } }) : [];
    const roles = applications.length ? await Role.find({ where: { guild_id: guildId, managed: true } }) : [];
    res.json(
        applications.map((app) => ({
            id: app.id,
            type: "discord",
            name: app.name,
            account: { id: app.id, name: app.name },
            enabled: true,
            scopes: ["bot", "applications.commands"],
            role_id: roles.find((r) => r.tags?.bot_id === app.id)?.id,
            user: app.owner?.toPublicUser(),
            application: {
                id: app.id,
                name: app.name,
                icon: app.icon ?? null,
                description: app.description ?? "",
                summary: app.summary ?? "",
                type: null,
                flags: app.flags ?? 0,
                bot: app.bot?.toPublicUser(),
            },
        })),
    );
});

router.delete("/:integration_id", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const guildId = req.params.guild_id as string;
    const integrationId = req.params.integration_id as string;
    if (!(await Member.exists({ where: { guild_id: guildId, id: integrationId, user: { bot: true } } }))) throw DiscordApiErrors.UNKNOWN_INTEGRATION;
    const app = await Application.findOne({ where: { id: integrationId }, select: { id: true, name: true } });
    await Member.removeFromGuild(integrationId, guildId);
    const reason = req.headers["x-audit-log-reason"];
    await AuditLog.log({
        guild_id: guildId,
        user_id: req.user_id,
        action_type: AuditLogEvents.INTEGRATION_DELETE,
        target_id: integrationId,
        changes: AuditLog.diff({ type: "discord", name: app?.name }, {}, ["type", "name"]),
        reason,
    });
    await AuditLog.log({ guild_id: guildId, user_id: req.user_id, action_type: AuditLogEvents.MEMBER_KICK, target_id: integrationId, reason });
    await emitEvent({ event: "GUILD_INTEGRATIONS_UPDATE", guild_id: guildId, data: { guild_id: guildId } } satisfies GuildIntegrationUpdateEvent);
    await emitCommandIndexUpdate(integrationId, guildId);
    res.sendStatus(204);
});

export default router;
