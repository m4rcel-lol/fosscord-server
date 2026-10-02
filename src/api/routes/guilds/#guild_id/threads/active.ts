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

import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { THREAD_TYPES } from "@spacebar/api/util";
import { Channel, Member, ThreadMember } from "@spacebar/database";
import { getPermission, Permissions } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {}, 403: {} } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as Record<string, string>;
    await Member.IsInGuildOrFail(req.user_id, guild_id);

    const threads = (await Channel.find({ where: { guild_id, type: In(THREAD_TYPES) } })).filter((t) => !t.thread_metadata?.archived);
    const joined = new Set((await ThreadMember.find({ where: { user_id: req.user_id, id: In(threads.map((t) => t.id)) } })).map((m) => m.id));
    const parentPerms = new Map<string, Permissions>();
    const visible: Channel[] = [];
    for (const thread of threads) {
        if (!thread.parent_id) continue;
        if (!parentPerms.has(thread.parent_id)) parentPerms.set(thread.parent_id, await getPermission(req.user_id, guild_id, thread.parent_id));
        const perms = parentPerms.get(thread.parent_id)!;
        if (!perms.has("VIEW_CHANNEL")) continue;
        if (thread.isPrivateThread() && !joined.has(thread.id) && !perms.has("MANAGE_THREADS")) continue;
        visible.push(thread);
    }
    const members = await ThreadMember.find({ where: { user_id: req.user_id, id: In(visible.map((t) => t.id)) } });
    return res.json({ threads: visible.map((t) => t.toJSON()), members: members.map((m) => m.toJSON()) });
});

export default router;
