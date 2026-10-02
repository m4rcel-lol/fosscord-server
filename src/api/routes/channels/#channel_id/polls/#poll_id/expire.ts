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
import { Message } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { finalizePoll } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ permission: "VIEW_CHANNEL" }), async (req: Request, res: Response) => {
    const { poll_id, channel_id } = req.params as { [key: string]: string };

    const message = await Message.findOne({ where: { id: poll_id, channel_id } });

    if (!message) throw DiscordApiErrors.UNKNOWN_MESSAGE;
    if (!message.poll) throw DiscordApiErrors.NON_POLL_MESSAGE_CANNOT_EXPIRE;
    if (message.poll.results?.is_finalized || new Date() > new Date(message.poll.expiry)) throw DiscordApiErrors.POLL_EXPIRED;
    if (message.author_id !== req.user_id) req.permission?.hasThrow("MANAGE_MESSAGES");

    const finalized = await finalizePoll(message.id);
    res.json(finalized?.toPublicJSON(req.user_id));
});

export default router;
