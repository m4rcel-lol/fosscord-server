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
import { Message, User } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { In } from "typeorm";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ permission: "VIEW_CHANNEL", query: { after: { type: "string" }, limit: { type: "number" } } }), async (req: Request, res: Response) => {
    const { poll_id, answer_id, channel_id } = req.params as { [key: string]: string };

    const message = await Message.findOne({ where: { id: poll_id, channel_id } });
    if (!message?.poll) throw DiscordApiErrors.UNKNOWN_MESSAGE;

    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const after = req.query.after ? BigInt(`${req.query.after}`) : 0n;
    const counts = (message.poll.results?.answer_counts ?? []) as unknown as { id: number | string; voters?: string[] }[];
    const voters = (counts.find((answer) => Number(answer.id) === Number(answer_id))?.voters ?? []).filter((id) => BigInt(id) > after);

    const users = voters.length ? await User.find({ where: { id: In(voters) }, order: { id: "ASC" }, take: limit }) : [];
    res.json({ users: users.map((user) => user.toPublicUser()) });
});

export default router;
