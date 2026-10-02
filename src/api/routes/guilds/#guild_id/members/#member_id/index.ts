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
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Ban, Emoji, Guild, Member, PublicGuildRelations, Role, Sticker, VoiceChannels, VoiceState } from "@spacebar/database";
import { IsNull, Not } from "typeorm";
import {
    CollectibleItemType,
    Collectibles,
    Config,
    DiscordApiErrors,
    emitEvent,
    FieldErrors,
    getPermission,
    getRights,
    GuildCreateEvent,
    GuildMemberUpdateEvent,
    handleFile,
    ReadyGuildDTO,
} from "@spacebar/util";
import { AuditLogEvents, MemberChangeSchema, PublicMemberProjection, PublicUserProjection } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "PublicMember",
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
        const { guild_id, member_id } = req.params as { [key: string]: string };
        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const member = await Member.findOneOrFail({
            where: { id: member_id, guild_id },
            relations: { roles: true, user: true },
            select: {
                index: true,
                // only grab public member props
                ...Object.fromEntries(PublicMemberProjection.map((x) => [x, true])),
                // and public user props
                user: Object.fromEntries(PublicUserProjection.map((x) => [x, true])),
                roles: {
                    id: true,
                },
            },
        });

        return res.json({
            ...member.toPublicMember(),
            user: member.user.toPublicUser(),
            roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
        });
    },
);

router.patch(
    "/",
    route({
        requestBody: "MemberChangeSchema",
        responses: {
            200: {
                body: "Member",
            },
            400: {
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
        const { guild_id } = req.params as { [key: string]: string };
        const member_id = req.params.member_id === "@me" ? req.user_id : (req.params.member_id as string);
        const body = req.body as MemberChangeSchema;

        const member = await Member.findOneOrFail({
            where: { id: member_id, guild_id },
            relations: { roles: true, user: true },
        });
        const before = { nick: member.nick, mute: member.mute, deaf: member.deaf, communication_disabled_until: member.communication_disabled_until?.toISOString() ?? null };
        const rolesBefore = member.roles.map((role) => role.id);
        const permission = await getPermission(req.user_id, guild_id);

        if ("nick" in body) {
            if (member_id != req.user_id) {
                permission.hasThrow("MANAGE_NICKNAMES");
            } else {
                permission.hasThrow("CHANGE_NICKNAME");
            }

            if (!body.nick) {
                delete body.nick;
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore shut up
                member.nick = null; // remove the nickname
            }
        }

        if (("bio" in body || "avatar" in body) && member_id != req.user_id) {
            const rights = await getRights(req.user_id);
            rights.hasThrow("MANAGE_USERS");
        }

        const {
            avatar_decoration_sku_id,
            collectibles,
            display_name_font_id,
            display_name_effect_id,
            display_name_colors,
            avatar_description,
            avatar_id,
            vad_colors,
            channel_id: voiceChannelId,
            ...changes
        } = body;

        if ("mute" in body) permission.hasThrow("MUTE_MEMBERS");
        if ("deaf" in body) permission.hasThrow("DEAFEN_MEMBERS");
        if ("channel_id" in body) {
            permission.hasThrow("MOVE_MEMBERS");
            if (voiceChannelId && !(await getPermission(member_id, guild_id, voiceChannelId)).has("CONNECT")) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("CONNECT");
            if (!(await VoiceState.exists({ where: { user_id: member_id, guild_id, channel_id: Not(IsNull()) } }))) throw DiscordApiErrors.TARGET_USER_IS_NOT_CONNECTED_TO_VOICE;
        }

        if (changes.avatar) changes.avatar = await handleFile(`/guilds/${guild_id}/users/${member_id}/avatars`, changes.avatar);
        else if (changes.avatar === null) Object.assign(member, { avatar: null });

        if (avatar_decoration_sku_id !== undefined) {
            const decoration = avatar_decoration_sku_id ? await Collectibles.item(avatar_decoration_sku_id, CollectibleItemType.AVATAR_DECORATION) : undefined;
            if (avatar_decoration_sku_id && !decoration?.asset) throw FieldErrors({ avatar_decoration_sku_id: { code: "50057", message: "Invalid SKU" } });
            Object.assign(member, { avatar_decoration_data: decoration?.asset ? { asset: decoration.asset, sku_id: decoration.sku_id, expires_at: null } : null });
        }

        if (collectibles !== undefined) {
            const nameplate = collectibles?.nameplate ? await Collectibles.item(collectibles.nameplate.sku_id, CollectibleItemType.NAMEPLATE) : undefined;
            if (collectibles?.nameplate && !nameplate?.asset) throw FieldErrors({ collectibles: { code: "50057", message: "Invalid SKU" } });
            Object.assign(member, {
                collectibles: nameplate?.asset
                    ? { nameplate: { asset: nameplate.asset, sku_id: nameplate.sku_id, label: nameplate.label ?? "", palette: nameplate.palette ?? "", expires_at: null } }
                    : null,
            });
        }

        if (display_name_font_id !== undefined || display_name_effect_id !== undefined || display_name_colors !== undefined)
            Object.assign(member, {
                display_name_styles:
                    display_name_font_id == null && display_name_effect_id == null && !display_name_colors?.length
                        ? null
                        : { font_id: display_name_font_id ?? 0, effect_id: display_name_effect_id ?? 0, colors: display_name_colors ?? [] },
            });

        member.assign(changes);

        // must do this after the assign because the body roles array
        // is string[] not Role[]
        if ("roles" in body) {
            permission.hasThrow("MANAGE_ROLES");

            body.roles = body.roles || [];
            body.roles.filter((x) => !!x);

            if (body.roles.indexOf(guild_id) === -1) body.roles.push(guild_id);
            // foreign key constraint will fail if role doesn't exist
            member.roles = body.roles.map((x) => Role.create({ id: x }));
        }

        if ("communication_disabled_until" in body) {
            permission.hasThrow("MODERATE_MEMBERS");
            member.communication_disabled_until = body.communication_disabled_until == null ? null : new Date(body.communication_disabled_until);
        }

        await member.save();
        if ("mute" in body || "deaf" in body) await VoiceChannels.setServerMute(guild_id, member_id, { mute: body.mute, deaf: body.deaf });
        if ("channel_id" in body) await VoiceChannels.move(guild_id, member_id, voiceChannelId ?? null);

        member.roles = member.roles.filter((x) => x.id !== guild_id);
        const data = { ...member.toPublicMember(), guild_id, user: member.user.toPublicUser(), roles: member.roles.map((x) => x.id) };

        // do not use promise.all as we have to first write to db before emitting the event to catch errors
        await emitEvent({
            event: "GUILD_MEMBER_UPDATE",
            guild_id,
            data,
        } satisfies GuildMemberUpdateEvent);

        const reason = req.headers["x-audit-log-reason"];
        const after = { nick: member.nick, mute: member.mute, deaf: member.deaf, communication_disabled_until: member.communication_disabled_until?.toISOString() ?? null };
        const auditChanges = AuditLog.diff(before, after, ["nick", "mute", "deaf", "communication_disabled_until"]);
        if (auditChanges.length)
            await AuditLog.log({ guild_id, user_id: req.user_id, action_type: AuditLogEvents.MEMBER_UPDATE, target_id: member_id, changes: auditChanges, reason });
        const added = data.roles.filter((id) => !rolesBefore.includes(id));
        const removed = rolesBefore.filter((id) => id !== guild_id && !data.roles.includes(id));
        if ("roles" in body && (added.length || removed.length)) {
            const names = new Map((await Role.find({ where: { guild_id }, select: { id: true, name: true } })).map((role) => [role.id, role.name]));
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.MEMBER_ROLE_UPDATE,
                target_id: member_id,
                changes: [
                    ...(added.length ? [{ key: "$add", new_value: added.map((id) => ({ id, name: names.get(id) })) }] : []),
                    ...(removed.length ? [{ key: "$remove", new_value: removed.map((id) => ({ id, name: names.get(id) })) }] : []),
                ] as unknown as AuditLog["changes"],
                reason,
            });
        }

        res.json(data);
    },
);

router.put(
    "/",
    route({
        responses: {
            200: {
                body: "MemberJoinGuildResponse",
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
        const rights = await getRights(req.user_id);

        const { guild_id } = req.params as { [key: string]: string };
        let { member_id } = req.params as { [key: string]: string };
        if (member_id === "@me") {
            member_id = req.user_id;
            rights.hasThrow("JOIN_GUILDS");
            if (req.user_bot && !Config.get().user.botsCanUseInvites) throw DiscordApiErrors.BOT_PROHIBITED_ENDPOINT;
        } else {
            // TODO: check oauth2 scope

            throw DiscordApiErrors.MISSING_REQUIRED_OAUTH2_SCOPE;
        }

        const guild = await Guild.findOne({
            where: { id: guild_id },
        });
        if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;

        const alreadyMember = await Member.existsBy({ id: member_id, guild_id });
        if (!alreadyMember && !guild.features.includes("DISCOVERABLE")) {
            throw DiscordApiErrors.UNKNOWN_GUILD;
        }

        const emoji = await Emoji.find({
            where: { guild_id: guild_id },
        });

        const roles = await Role.find({
            where: { guild_id: guild_id },
        });

        const stickers = await Sticker.find({
            where: { guild_id: guild_id },
        });

        if (!alreadyMember && req.query.lurker === "true") {
            if (await Ban.exists({ where: { guild_id, user_id: member_id } })) throw DiscordApiErrors.USER_BANNED;
            const full = await Guild.findOneOrFail({
                where: { id: guild_id },
                relations: Object.fromEntries(PublicGuildRelations.map((i) => [i, true])),
                relationLoadStrategy: "query",
            });
            const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : undefined;
            await emitEvent({
                event: "GUILD_CREATE",
                data: {
                    ...new ReadyGuildDTO(full).toJSON(),
                    members: [],
                    member_count: full.member_count,
                    guild_hashes: {},
                    guild_scheduled_events: [],
                    joined_at: null,
                    presences: [],
                    stage_instances: [],
                    threads: [],
                    embedded_activities: [],
                    voice_states: full.voice_states.map((x) => x.toPublicVoiceState()),
                },
                ...(sessionId ? { session_id: sessionId } : { user_id: member_id }),
            } satisfies GuildCreateEvent);
            return res.send({ ...guild, emojis: emoji, roles: roles, stickers: stickers, approximate_presence_count: await Guild.countOnlineMembers(guild_id) });
        }

        if (!alreadyMember) await Member.addToGuild(member_id, guild_id);
        res.send({ ...guild, emojis: emoji, roles: roles, stickers: stickers });
    },
);

router.delete(
    "/",
    route({
        responses: {
            204: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, member_id } = req.params as { [key: string]: string };
        const permission = await getPermission(req.user_id, guild_id);
        const rights = await getRights(req.user_id);
        if (member_id === "@me" || member_id === req.user_id) {
            // TODO: unless force-joined
            rights.hasThrow("SELF_LEAVE_GROUPS");
        } else {
            rights.hasThrow("KICK_BAN_MEMBERS");
            permission.hasThrow("KICK_MEMBERS");
        }

        const target = member_id === "@me" ? req.user_id : member_id;
        await Member.removeFromGuild(target, guild_id);
        if (target !== req.user_id)
            await AuditLog.log({ guild_id, user_id: req.user_id, action_type: AuditLogEvents.MEMBER_KICK, target_id: target, reason: req.headers["x-audit-log-reason"] });
        res.sendStatus(204);
    },
);

export default router;
