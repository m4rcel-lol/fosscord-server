/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2025 Spacebar and Spacebar Contributors

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
import { In, MoreThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Channel, Member, ThreadMember, ThreadMemberFlags } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, getPermission, ThreadMemberUpdateEvent } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";

const router = Router({ mergeParams: true });

const getThread = async (channel_id: string) => {
    const thread = await Channel.findOne({ where: { id: channel_id } });
    if (!thread?.isThread()) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    return thread;
};

const withMembers = async (members: ThreadMember[], guild_id: string) => {
    const guildMembers = await Member.find({ where: { guild_id, id: In(members.map((m) => m.user_id)) }, relations: { user: true, roles: true } });
    const byId = new Map(guildMembers.map((m) => [m.id, m]));
    return members.map((m) => {
        const member = byId.get(m.user_id);
        return { ...m.toJSON(), ...(member ? { member: { ...member.toPublicMember(), roles: member.roles.filter((r) => r.id !== guild_id).map((r) => r.id) } } : {}) };
    });
};

router.get("/", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const { with_member, after, limit } = req.query as Record<string, string | undefined>;
    const thread = await getThread(channel_id);
    const members = await ThreadMember.find({
        where: { id: thread.id, ...(after ? { user_id: MoreThan(after) } : {}) },
        order: { user_id: "ASC" },
        take: Math.min(Number(limit) || 100, 100),
    });
    if (with_member === "true") return res.json(await withMembers(members, thread.guild_id!));
    return res.json(members.map((m) => m.toJSON()));
});

router.get("/:user_id", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const user_id = req.params.user_id === "@me" ? req.user_id : (req.params.user_id as string);
    const thread = await getThread(channel_id);
    const member = await ThreadMember.findOne({ where: { id: thread.id, user_id } });
    if (!member) throw DiscordApiErrors.UNKNOWN_MEMBER;
    if (req.query.with_member === "true") return res.json((await withMembers([member], thread.guild_id!))[0]);
    return res.json(member.toJSON());
});

const addMember = async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const self = req.params.user_id === "@me" || req.params.user_id === req.user_id;
    const user_id = self ? req.user_id : (req.params.user_id as string);
    const thread = await getThread(channel_id);

    if (thread.thread_metadata?.archived) {
        if (thread.thread_metadata.locked && !req.permission!.has("MANAGE_THREADS")) throw DiscordApiErrors.THREAD_IS_LOCKED;
    }
    if (!self) {
        req.permission!.hasThrow("SEND_MESSAGES_IN_THREADS");
        if (thread.isPrivateThread() && !thread.thread_metadata?.invitable && !req.permission!.has("MANAGE_THREADS") && thread.owner_id !== req.user_id)
            throw DiscordApiErrors.MISSING_PERMISSIONS;
        if (!(await getPermission(user_id, thread.guild_id, thread.parent_id!)).has("VIEW_CHANNEL")) throw DiscordApiErrors.MISSING_PERMISSIONS;
    } else if (thread.isPrivateThread() && !req.permission!.has("MANAGE_THREADS")) {
        if (!(await ThreadMember.existsBy({ id: thread.id, user_id }))) throw DiscordApiErrors.MISSING_PERMISSIONS;
    }

    await ThreadMember.join(thread, user_id, self ? ThreadMemberFlags.HAS_INTERACTED : ThreadMemberFlags.NONE);
    return res.sendStatus(204);
};

router.post("/:user_id", route({ permission: "VIEW_CHANNEL", responses: { 204: {}, 403: {} } }), addMember);
router.put("/:user_id", route({ permission: "VIEW_CHANNEL", responses: { 204: {}, 403: {} } }), addMember);

router.delete("/:user_id", route({ permission: "VIEW_CHANNEL", responses: { 204: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const self = req.params.user_id === "@me" || req.params.user_id === req.user_id;
    const user_id = self ? req.user_id : (req.params.user_id as string);
    const thread = await getThread(channel_id);
    if (!self && !req.permission!.has("MANAGE_THREADS") && !(thread.isPrivateThread() && thread.owner_id === req.user_id)) throw DiscordApiErrors.MISSING_PERMISSIONS;
    if (thread.thread_metadata?.archived && !self) throw DiscordApiErrors.CANNOT_EDIT_ARCHIVED_THREAD;

    await ThreadMember.leave(thread, user_id);
    return res.sendStatus(204);
});

router.patch("/@me/settings", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const thread = await getThread(channel_id);
    const body = req.body as { flags?: number; muted?: boolean; mute_config?: { end_time?: string | null; selected_time_window?: number } | null };
    const member = await ThreadMember.findOne({ where: { id: thread.id, user_id: req.user_id } });
    if (!member) throw new HTTPError("You are not member of this thread", 403);

    if (body.flags !== undefined) member.flags = Number(body.flags);
    if (body.muted !== undefined) member.muted = !!body.muted;
    if (body.mute_config !== undefined)
        member.mute_config = body.mute_config
            ? { end_time: body.mute_config.end_time ? new Date(body.mute_config.end_time) : undefined, selected_time_window: body.mute_config.selected_time_window }
            : undefined;
    await member.save();

    await emitEvent({
        event: "THREAD_MEMBER_UPDATE",
        data: { ...member.toJSON(), guild_id: thread.guild_id! },
        user_id: req.user_id,
    } satisfies ThreadMemberUpdateEvent);

    return res.json(member.toJSON());
});

export default router;
