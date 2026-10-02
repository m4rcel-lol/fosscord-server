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
import { Channel } from "@spacebar/database";
import { ChannelType } from "@spacebar/schemas";
import { Not, IsNull } from "typeorm";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const channels = await Channel.find({
        where: { guild_id, type: ChannelType.GUILD_TEXT, last_message_id: Not(IsNull()) },
        select: { id: true, last_message_id: true },
    });
    res.json(
        channels
            .sort((a, b) => (BigInt(b.last_message_id!) > BigInt(a.last_message_id!) ? 1 : -1))
            .slice(0, 10)
            .map((channel) => channel.id),
    );
});

export default router;
