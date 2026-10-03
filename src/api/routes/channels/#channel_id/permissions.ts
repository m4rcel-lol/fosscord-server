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
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Channel, Member, Role } from "@spacebar/database";
import { ChannelUpdateEvent, emitEvent } from "@spacebar/util";
import { AuditLogEvents, ChannelPermissionOverwriteSchema, ChannelPermissionOverwrite, ChannelPermissionOverwriteType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

// TODO: Only permissions your bot has in the guild or channel can be allowed/denied (unless your bot has a MANAGE_ROLES overwrite in the channel)

router.put(
    "/:overwrite_id",
    route({
        requestBody: "ChannelPermissionOverwriteSchema",
        permission: "MANAGE_ROLES",
        responses: {
            204: {},
            404: {},
            501: {},
            400: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, overwrite_id } = req.params as { [key: string]: string };
        const body = req.body as ChannelPermissionOverwriteSchema;

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
        });
        if (!channel.guild_id) throw new HTTPError("Channel not found", 404);
        channel.position = await Channel.calculatePosition(channel_id, channel.guild_id, channel.guild);

        if (body.type === ChannelPermissionOverwriteType.role) {
            if (!(await Role.count({ where: { id: overwrite_id, guild_id: channel.guild_id } }))) throw new HTTPError("role not found", 404);
        } else if (body.type === ChannelPermissionOverwriteType.member) {
            if (!(await Member.count({ where: { id: overwrite_id, guild_id: channel.guild_id } }))) throw new HTTPError("user not found", 404);
        } else throw new HTTPError("type not supported", 501);

        let overwrite: ChannelPermissionOverwrite | undefined = channel.permission_overwrites?.find((x) => x.id === overwrite_id);
        const before = overwrite ? { ...overwrite } : undefined;
        if (!overwrite) {
            overwrite = {
                id: overwrite_id,
                type: body.type,
                allow: "0",
                deny: "0",
            };
            channel.permission_overwrites?.push(overwrite);
        }
        overwrite.allow = String((req.permission?.bitfield || 0n) & BigInt(body.allow || "0"));
        overwrite.deny = String((req.permission?.bitfield || 0n) & BigInt(body.deny || "0"));

        await Promise.all([
            channel.save(),
            emitEvent({
                event: "CHANNEL_UPDATE",
                channel_id,
                data: channel.toJSON(),
            } satisfies ChannelUpdateEvent),
            AuditLog.log({
                guild_id: channel.guild_id,
                user_id: req.user_id,
                action_type: before ? AuditLogEvents.CHANNEL_OVERWRITE_UPDATE : AuditLogEvents.CHANNEL_OVERWRITE_CREATE,
                target_id: channel_id,
                changes: before ? AuditLog.diff(before, overwrite, ["allow", "deny"]) : AuditLog.diff({}, overwrite, ["id", "type", "allow", "deny"]),
                options: { id: overwrite_id, type: String(overwrite.type) },
                reason: req.headers["x-audit-log-reason"],
            }),
        ]);

        return res.sendStatus(204);
    },
);

// TODO: check permission hierarchy
router.delete("/:overwrite_id", route({ permission: "MANAGE_ROLES", responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    const { channel_id, overwrite_id } = req.params as { [key: string]: string };

    const channel = await Channel.findOneOrFail({
        where: { id: channel_id },
    });
    if (!channel.guild_id) throw new HTTPError("Channel not found", 404);

    const removed = channel.permission_overwrites?.find((x) => x.id === overwrite_id);
    channel.permission_overwrites = channel.permission_overwrites?.filter((x) => x.id !== overwrite_id);
    if (removed)
        await AuditLog.log({
            guild_id: channel.guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.CHANNEL_OVERWRITE_DELETE,
            target_id: channel_id,
            changes: AuditLog.diff(removed, {}, ["id", "type", "allow", "deny"]),
            options: { id: overwrite_id, type: String(removed.type) },
            reason: req.headers["x-audit-log-reason"],
        });

    await Promise.all([
        channel.save(),
        emitEvent({
            event: "CHANNEL_UPDATE",
            channel_id,
            data: channel.toJSON(),
        } satisfies ChannelUpdateEvent),
    ]);

    return res.sendStatus(204);
});

export default router;
