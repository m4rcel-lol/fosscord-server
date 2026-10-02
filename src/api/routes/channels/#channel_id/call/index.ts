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
import { route } from "@spacebar/api/middlewares";
import { Channel, Recipient } from "@spacebar/database";
import { DiscordApiErrors, ringCall, stopRingingCall } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

const privateChannel = async (channel_id: string, user_id: string) => {
    const channel = await Channel.findOne({ where: { id: channel_id }, select: { id: true, type: true } });
    if (!channel?.isDm() || !(await Recipient.exists({ where: { channel_id, user_id } }))) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    return channel;
};

const recipientList = (body: unknown) => {
    const recipients = (body as { recipients?: unknown } | undefined)?.recipients;
    return Array.isArray(recipients) ? recipients.filter((x): x is string => typeof x === "string") : null;
};

router.get("/", route({ responses: { 200: {}, 404: {} } }), async (req: Request, res: Response) => {
    await privateChannel(req.params.channel_id as string, req.user_id);
    res.json({ ringable: true });
});

router.patch("/", route({ responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    await privateChannel(req.params.channel_id as string, req.user_id);
    res.sendStatus(204);
});

router.post("/ring", route({ responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    const channel = await privateChannel(req.params.channel_id as string, req.user_id);
    await ringCall(channel.id, req.user_id, recipientList(req.body));
    res.sendStatus(204);
});

router.post("/stop-ringing", route({ responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    const channel = await privateChannel(req.params.channel_id as string, req.user_id);
    await stopRingingCall(channel.id, req.user_id, recipientList(req.body));
    res.sendStatus(204);
});

export default router;
