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

import { In, Not } from "typeorm";
import { Ban, Channel, Guild, GuildJoinRequest, GuildJoinRequestStatus, Member, Recipient, User } from "@spacebar/database";
import { ChannelType, GuildMemberVerificationFormField } from "@spacebar/schemas";
import {
    ApiError,
    DiscordApiErrors,
    DmChannelDTO,
    emitEvent,
    FieldErrors,
    GuildJoinRequestCreateEvent,
    GuildJoinRequestDeleteEvent,
    GuildMemberUpdateEvent,
    getPermission,
} from "@spacebar/util";
import { onGuildMemberJoin } from "./automod";

export const JOIN_REQUEST_INTERVIEW_CHANNEL_FLAG = 1 << 16;
export const APPLICATION_BYPASS_INVITE_FLAG = 1 << 3;

export const UNKNOWN_JOIN_REQUEST = new ApiError("Unknown Guild Join Request", 10075, 404);

export const isApplyGuild = (features: string[]) => features.includes("MEMBER_VERIFICATION_GATE_ENABLED") && features.includes("MEMBER_VERIFICATION_MANUAL_APPROVAL");

export const needsManualApproval = (fields: GuildMemberVerificationFormField[] | undefined) => !!fields?.some((field) => field.field_type !== "TERMS");

const relations = { user: true, actioned_by: true } as const;

export const findJoinRequest = (where: { id?: string; guild_id?: string; user_id?: string }) => GuildJoinRequest.findOne({ where, relations });

type JoinRequestEvent = "GUILD_JOIN_REQUEST_CREATE" | "GUILD_JOIN_REQUEST_UPDATE";

export async function emitJoinRequest(event: JoinRequestEvent, request: GuildJoinRequest, moderatorEvent: JoinRequestEvent = event) {
    const { guild_id, application_status: status, user_id } = request;
    await Promise.all([
        emitEvent({ event, user_id, data: { guild_id, status, request: request.toJSON("self") } } satisfies GuildJoinRequestCreateEvent),
        status === "STARTED"
            ? null
            : emitEvent({ event: moderatorEvent, guild_id, data: { guild_id, status, request: request.toJSON("moderator") } } satisfies GuildJoinRequestCreateEvent),
    ]);
}

export async function deleteJoinRequest(request: GuildJoinRequest) {
    await GuildJoinRequest.delete({ id: request.id });
    const data = { guild_id: request.guild_id, id: request.id, user_id: request.user_id };
    await Promise.all([
        emitEvent({ event: "GUILD_JOIN_REQUEST_DELETE", user_id: request.user_id, data } satisfies GuildJoinRequestDeleteEvent),
        request.application_status === "STARTED" ? null : emitEvent({ event: "GUILD_JOIN_REQUEST_DELETE", guild_id: request.guild_id, data } satisfies GuildJoinRequestDeleteEvent),
    ]);
}

export async function startJoinRequest(guild_id: string, user_id: string) {
    const existing = await findJoinRequest({ guild_id, user_id });
    if (existing && existing.application_status !== "APPROVED") return existing;
    if (existing) await deleteJoinRequest(existing);
    const request = GuildJoinRequest.create({ guild_id, user_id, application_status: "STARTED", created_at: new Date(), form_responses: [] });
    await request.save();
    request.user = (await User.findOne({ where: { id: user_id } })) ?? undefined;
    await emitJoinRequest("GUILD_JOIN_REQUEST_CREATE", request);
    return request;
}

export function validateFormResponses(fields: GuildMemberVerificationFormField[], submitted: unknown) {
    const answers = Array.isArray(submitted) ? (submitted as Partial<GuildMemberVerificationFormField>[]) : [];
    const errors: Record<string, { code: string; message: string }> = {};
    const responses = fields.map((field, index) => {
        const answer = answers.find((candidate) => candidate?.field_type === field.field_type && candidate?.label === field.label) ?? answers[index];
        const raw = answer?.response;
        const response = (() => {
            if (raw == null || raw === "") return null;
            if (field.field_type === "TERMS") return raw === true ? true : null;
            if (field.field_type === "MULTIPLE_CHOICE") {
                const choices = (field as { choices?: string[] }).choices ?? field.values ?? [];
                return Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) < choices.length ? raw : null;
            }
            if (typeof raw !== "string") return null;
            const max = field.field_type === "PARAGRAPH" ? 1000 : 150;
            if (raw.length > max) errors[`form_fields.${index}.response`] = { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${max} or fewer in length.` };
            return raw.trim() || null;
        })();
        if (field.required && response == null) errors[`form_fields.${index}.response`] ??= { code: "BASE_TYPE_REQUIRED", message: "This field is required" };
        return { ...field, response };
    });
    if (Object.keys(errors).length) throw FieldErrors(errors);
    return responses;
}

export async function submitJoinRequest(guild: Guild, user_id: string, form_fields: unknown) {
    const fields = guild.member_verification?.form_fields ?? [];
    const form_responses = validateFormResponses(fields, form_fields);
    const existing = await findJoinRequest({ guild_id: guild.id, user_id });
    const isMember = await Member.exists({ where: { id: user_id, guild_id: guild.id } });
    if (!existing && !isMember) throw UNKNOWN_JOIN_REQUEST;
    if (existing?.application_status === "APPROVED" && isMember) return existing;
    if (existing?.application_status === "REJECTED") throw new ApiError("Your application was rejected, reset it before applying again", 150023, 403);

    const request = existing ?? GuildJoinRequest.create({ guild_id: guild.id, user_id, created_at: new Date() });
    const wasSubmitted = request.application_status === "SUBMITTED";
    request.form_responses = form_responses;
    request.application_status = "SUBMITTED";
    await request.save();
    request.user ??= (await User.findOne({ where: { id: user_id } })) ?? undefined;
    await emitJoinRequest(existing ? "GUILD_JOIN_REQUEST_UPDATE" : "GUILD_JOIN_REQUEST_CREATE", request, wasSubmitted ? "GUILD_JOIN_REQUEST_UPDATE" : "GUILD_JOIN_REQUEST_CREATE");
    return request;
}

export async function actionJoinRequest(
    request: GuildJoinRequest,
    moderator_id: string,
    action: Extract<GuildJoinRequestStatus, "APPROVED" | "REJECTED">,
    rejection_reason?: string | null,
) {
    if (request.application_status === "STARTED") throw new ApiError("This application has not been submitted yet", 150023, 400);
    const { guild_id, user_id } = request;
    const member = await Member.findOne({ where: { id: user_id, guild_id }, relations: { user: true, roles: true } });

    if (action === "APPROVED") {
        if (member?.pending) {
            member.pending = false;
            await member.save();
            await emitEvent({
                event: "GUILD_MEMBER_UPDATE",
                guild_id,
                data: { ...member.toPublicMember(), guild_id, user: member.user.toPublicUser(), roles: member.roles.map((role) => role.id).filter((id) => id !== guild_id) },
            } satisfies GuildMemberUpdateEvent);
        } else if (!member) {
            if (await Ban.exists({ where: { guild_id, user_id } })) throw new ApiError("This user is banned from the server", 150023, 400);
            await Member.addToGuild(user_id, guild_id, false, { join_source_type: 5, pending: false });
            await onGuildMemberJoin(guild_id, user_id);
        }
    } else if (member?.pending) await Member.removeFromGuild(user_id, guild_id);

    request.application_status = action;
    request.actioned_at = new Date();
    request.actioned_by_id = moderator_id;
    request.actioned_by = (await User.findOne({ where: { id: moderator_id } })) ?? null;
    request.rejection_reason = action === "REJECTED" ? (rejection_reason?.trim().slice(0, 160) ?? null) || null : null;
    request.last_seen = null;
    await request.save();
    await emitJoinRequest("GUILD_JOIN_REQUEST_UPDATE", request);
    return request;
}

export async function bulkActionJoinRequests(guild_id: string, moderator_id: string, action: "APPROVED" | "REJECTED") {
    const requests = await GuildJoinRequest.find({ where: { guild_id, application_status: "SUBMITTED" }, relations });
    for (const request of requests) await actionJoinRequest(request, moderator_id, action).catch((error) => console.error("[JoinRequests] bulk action failed", request.id, error));
    return requests.length;
}

export async function joinRequestGuildsForUser(user_id: string) {
    const requests = await GuildJoinRequest.find({ where: { user_id, application_status: Not(In(["APPROVED"])) }, select: { guild_id: true } });
    if (!requests.length) return [];
    const memberOf = new Set((await Member.find({ where: { id: user_id, guild_id: In(requests.map((r) => r.guild_id)) }, select: { guild_id: true } })).map((m) => m.guild_id));
    const guilds = await Guild.find({ where: { id: In(requests.map((r) => r.guild_id).filter((id) => !memberOf.has(id))) } });
    return guilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon ?? null,
        splash: guild.splash ?? null,
        discovery_splash: guild.discovery_splash ?? null,
        banner: guild.banner ?? null,
        description: guild.description ?? null,
        features: guild.features,
        approximate_member_count: guild.member_count ?? 0,
    }));
}

export async function openInterview(request: GuildJoinRequest, moderator_id: string) {
    const existing = await Channel.findOne({ where: { id: request.id }, relations: { recipients: true } });
    if (existing) {
        if (!existing.recipients?.some((recipient) => recipient.user_id === moderator_id)) {
            await Recipient.create({ channel_id: existing.id, user_id: moderator_id, closed: false }).save();
            existing.recipients = [...(existing.recipients ?? []), Recipient.create({ channel_id: existing.id, user_id: moderator_id, closed: false })];
            const dto = await DmChannelDTO.from(existing);
            await emitEvent({ event: "CHANNEL_CREATE", data: dto.excludedRecipients([moderator_id]), user_id: moderator_id });
            for (const recipient of existing.recipients.filter((r) => r.user_id !== moderator_id))
                await emitEvent({ event: "CHANNEL_RECIPIENT_ADD", channel_id: existing.id, data: { channel_id: existing.id, user: await User.getPublicUser(moderator_id) } });
        }
        return DmChannelDTO.from(existing);
    }

    const guild = await Guild.findOneOrFail({ where: { id: request.guild_id }, select: { id: true, name: true } });
    const recipients = [request.user_id, moderator_id];
    const channel = await Channel.create({
        id: request.id,
        name: guild.name,
        type: ChannelType.GROUP_DM,
        owner_id: moderator_id,
        created_at: new Date(),
        flags: JOIN_REQUEST_INTERVIEW_CHANNEL_FLAG,
        nsfw: false,
        recipients: recipients.map((user_id) => Recipient.create({ user_id, closed: false })),
    }).save();
    const dto = await DmChannelDTO.from(channel);
    for (const user_id of recipients) await emitEvent({ event: "CHANNEL_CREATE", data: dto.excludedRecipients([user_id]), user_id });

    request.interview_channel_id = channel.id;
    await request.save();
    await emitJoinRequest("GUILD_JOIN_REQUEST_UPDATE", request);
    return dto;
}

export async function ackJoinRequest(guild_id: string, user_id: string) {
    const request = await findJoinRequest({ guild_id, user_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    if (request.application_status !== "APPROVED" || request.last_seen) return request;
    request.last_seen = new Date();
    await request.save();
    await emitEvent({
        event: "GUILD_JOIN_REQUEST_UPDATE",
        user_id,
        data: { guild_id, status: request.application_status, request: request.toJSON("self") },
    } satisfies GuildJoinRequestCreateEvent);
    return request;
}

export async function requireJoinRequestModerator(guild_id: string, user_id: string) {
    const permission = await getPermission(user_id, guild_id).catch(() => null);
    if (!permission?.has("KICK_MEMBERS")) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("KICK_MEMBERS");
}
