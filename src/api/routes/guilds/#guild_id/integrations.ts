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
import { Application, Member, Role } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, GuildIntegrationUpdateEvent, GuildRoleDeleteEvent } from "@spacebar/util";
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
    const roles = (await Role.find({ where: { guild_id: guildId, managed: true } })).filter((r) => r.tags?.bot_id === integrationId);
    await Member.removeFromGuild(integrationId, guildId);
    for (const role of roles) {
        await Role.delete({ id: role.id });
        await emitEvent({ event: "GUILD_ROLE_DELETE", guild_id: guildId, data: { guild_id: guildId, role_id: role.id } } satisfies GuildRoleDeleteEvent);
    }
    await emitEvent({ event: "GUILD_INTEGRATIONS_UPDATE", guild_id: guildId, data: { guild_id: guildId } } satisfies GuildIntegrationUpdateEvent);
    await emitCommandIndexUpdate(integrationId, guildId);
    res.sendStatus(204);
});

export default router;
