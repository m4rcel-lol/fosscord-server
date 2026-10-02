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
import { Channel, VoiceState } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, getPermission } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";
import { HTTPError } from "lambert-server";

const router: Router = Router({ mergeParams: true });

router.put("/", route({ responses: { 204: {}, 400: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const channel = await Channel.findOneOrFail({ where: { id: req.params.channel_id as string }, select: { id: true, guild_id: true, type: true } });
    if (!channel.guild_id || channel.type !== ChannelType.GUILD_VOICE) throw DiscordApiErrors.UNKNOWN_CHANNEL;

    const raw = req.body?.status;
    if (raw != null && typeof raw !== "string") throw new HTTPError("status must be a string", 400);
    const status = raw?.trim() ? raw.slice(0, 500) : null;

    const permissions = await getPermission(req.user_id, channel.guild_id, channel.id);
    const connected = await VoiceState.exists({ where: { user_id: req.user_id, channel_id: channel.id } });
    if (!permissions.has("MANAGE_CHANNELS") && !(connected && permissions.has("SET_VOICE_CHANNEL_STATUS"))) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("SET_VOICE_CHANNEL_STATUS");

    await Channel.update({ id: channel.id }, { status });
    await emitEvent({ event: "VOICE_CHANNEL_STATUS_UPDATE", guild_id: channel.guild_id, data: { id: channel.id, guild_id: channel.guild_id, status } });
    res.sendStatus(204);
});

export default router;
