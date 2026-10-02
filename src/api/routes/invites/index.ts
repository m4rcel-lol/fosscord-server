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

import { route } from "@spacebar/api/middlewares";
import { AuditLog, Ban, Guild, Invite, Member, PublicInviteRelation } from "@spacebar/database";
import { Config, DiscordApiErrors, emitEvent, getPermission, InviteDeleteEvent } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { AuditLogEvents, UserFlags } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/:invite_code",
    route({
        responses: {
            "200": {
                body: "Invite",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { invite_code } = req.params as { [key: string]: string };

        const invite = await Invite.findOne({
            where: { code: invite_code },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])), //TODO: clean up
        });
        if (!invite?.guild || !invite.channel) throw DiscordApiErrors.UNKNOWN_INVITE;
        if (invite.isExpired()) {
            await Invite.delete({ code: invite_code });
            throw DiscordApiErrors.UNKNOWN_INVITE;
        }

        await invite.guild.withPresenceCount();
        res.status(200).send(invite.toPublicJSON());
    },
);

router.post(
    "/:invite_code",
    route({
        right: "USE_MASS_INVITES",
        responses: {
            "200": {
                body: "Invite",
            },
            401: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        if (req.user_bot && !Config.get().user.botsCanUseInvites) throw DiscordApiErrors.BOT_PROHIBITED_ENDPOINT;

        const { invite_code } = req.params as { [key: string]: string };
        const { public_flags } = req.user;
        const found = await Invite.findOne({
            where: { code: invite_code },
        });
        if (!found) throw DiscordApiErrors.UNKNOWN_INVITE;
        const { guild_id } = found;
        const { features, incidents_data } = await Guild.findOneOrFail({
            where: { id: guild_id },
        });
        const ban = await Ban.findOne({
            where: [
                { guild_id: guild_id, user_id: req.user_id },
                { guild_id: guild_id, ip: req.ip },
            ],
        });

        if (ban) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but is banned by ${ban.user_id === req.user_id ? "User ID" : "IP address"}.`);
            throw DiscordApiErrors.USER_BANNED;
        }

        if ((BigInt(public_flags) & UserFlags.FLAGS.QUARANTINED) === UserFlags.FLAGS.QUARANTINED) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but is quarantined.`);
            throw DiscordApiErrors.UNKNOWN_INVITE;
        }

        if (features.includes("INTERNAL_EMPLOYEE_ONLY") && (public_flags & 1) !== 1) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but is not staff.`);
            throw new HTTPError("Only intended for the staff of this instance.", 401);
        }

        if (features.includes("INVITES_DISABLED")) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but joins are closed.`);
            throw new HTTPError("Sorry, this guild has joins closed.", 403);
        }

        const invitesPaused = incidents_data?.invites_disabled_until && new Date(incidents_data.invites_disabled_until).getTime() > Date.now();
        if (invitesPaused && !(await Member.findOne({ where: { id: req.user_id, guild_id }, select: { index: true } }))) {
            throw new HTTPError("Invites to this server are paused.", 403);
        }

        const { new_member } = await Invite.joinGuild(req.user_id, invite_code);
        const invite = await Invite.findOneOrFail({
            where: { code: invite_code },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])),
        }).catch(() => null);
        if (!invite) return res.json({ code: invite_code, guild_id, new_member });

        res.json({ ...invite.toPublicJSON(), new_member });
    },
);

// * cant use permission of route() function because path doesn't have guild_id/channel_id
router.delete(
    "/:invite_code",
    route({
        responses: {
            "200": {
                body: "Invite",
            },
            401: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { invite_code } = req.params as { [key: string]: string };
        const invite = await Invite.findOne({
            where: { code: invite_code },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])),
        });
        if (!invite) throw DiscordApiErrors.UNKNOWN_INVITE;
        const { guild_id, channel_id } = invite;

        const permission = await getPermission(req.user_id, guild_id, channel_id);

        if (!permission.has("MANAGE_GUILD") && !permission.has("MANAGE_CHANNELS")) throw new HTTPError("You missing the MANAGE_GUILD or MANAGE_CHANNELS permission", 401);

        await Promise.all([
            Invite.delete({ code: invite_code }),
            AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.INVITE_DELETE,
                changes: AuditLog.diff({ ...invite, inviter_id: invite.inviter_id }, {}, ["code", "channel_id", "inviter_id", "uses", "max_uses", "max_age", "temporary", "flags"]),
                reason: req.headers["x-audit-log-reason"],
            }),
            emitEvent({
                event: "INVITE_DELETE",
                guild_id: guild_id,
                data: {
                    channel_id: channel_id,
                    guild_id: guild_id,
                    code: invite_code,
                },
            } satisfies InviteDeleteEvent),
        ]);

        res.json(invite.toMetadataJSON());
    },
);

export default router;
