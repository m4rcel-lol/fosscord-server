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
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Channel, User } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const channel = await Channel.findOne({ where: { id: req.params.channel_id as string }, relations: { recipients: true } });
    if (!channel || !channel.recipients?.some((r) => r.user_id === req.user_id)) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    const others = channel.recipients.map((r) => r.user_id).filter((id) => id !== req.user_id);
    const bots = channel.type === ChannelType.DM && others.length ? await User.find({ where: { id: In(others), bot: true }, select: { id: true } }) : [];
    res.json(
        await buildCommandIndex(
            bots.map((b) => b.id),
            { context: 1, integrationType: 0 },
        ),
    );
});

export default router;
