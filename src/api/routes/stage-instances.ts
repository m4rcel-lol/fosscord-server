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
import { Channel, StageInstance } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, FieldErrors, getPermission } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const stageChannel = async (channel_id: string | undefined, user_id: string, moderate: boolean) => {
    if (!channel_id) throw FieldErrors({ channel_id: { code: "BASE_TYPE_REQUIRED", message: "This field is required" } });
    const channel = await Channel.findOne({ where: { id: channel_id } });
    if (!channel?.guild_id) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    if (channel.type !== ChannelType.GUILD_STAGE_VOICE) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
    const permissions = await getPermission(user_id, channel.guild_id, channel);
    permissions.hasThrow("VIEW_CHANNEL");
    if (moderate) {
        permissions.hasThrow("MANAGE_CHANNELS");
        permissions.hasThrow("MUTE_MEMBERS");
        permissions.hasThrow("MOVE_MEMBERS");
    }
    return channel;
};

const validateTopic = (topic: unknown) => {
    if (typeof topic !== "string" || !topic.trim().length || topic.length > 120)
        throw FieldErrors({ topic: { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 1 and 120 in length." } });
    return topic.trim();
};

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json([]);
});

router.post("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const body = req.body as { channel_id?: string; topic?: string; privacy_level?: number; guild_scheduled_event_id?: string | null };
    const channel = await stageChannel(body.channel_id, req.user_id, true);
    if (await StageInstance.existsBy({ channel_id: channel.id })) throw DiscordApiErrors.STAGE_ALREADY_OPEN;

    const instance = await StageInstance.create({
        guild_id: channel.guild_id,
        channel_id: channel.id,
        topic: validateTopic(body.topic),
        privacy_level: 2,
        guild_scheduled_event_id: body.guild_scheduled_event_id ?? null,
    }).save();
    await emitEvent({ event: "STAGE_INSTANCE_CREATE", data: instance.toJSON(), guild_id: channel.guild_id });
    return res.json(instance.toJSON());
});

router.get("/:channel_id", route({}), async (req: Request, res: Response) => {
    const channel = await stageChannel(req.params.channel_id as string, req.user_id, false);
    const instance = await StageInstance.findOne({ where: { channel_id: channel.id } });
    if (!instance) throw DiscordApiErrors.UNKNOWN_STAGE_INSTANCE;
    return res.json(instance.toJSON());
});

router.patch("/:channel_id", route({}), async (req: Request, res: Response) => {
    const channel = await stageChannel(req.params.channel_id as string, req.user_id, true);
    const instance = await StageInstance.findOne({ where: { channel_id: channel.id } });
    if (!instance) throw DiscordApiErrors.UNKNOWN_STAGE_INSTANCE;
    const body = req.body as { topic?: string; privacy_level?: number };
    if (body.topic !== undefined) instance.topic = validateTopic(body.topic);
    await instance.save();
    await emitEvent({ event: "STAGE_INSTANCE_UPDATE", data: instance.toJSON(), guild_id: channel.guild_id });
    return res.json(instance.toJSON());
});

router.delete("/:channel_id", route({}), async (req: Request, res: Response) => {
    const channel = await stageChannel(req.params.channel_id as string, req.user_id, true);
    const instance = await StageInstance.findOne({ where: { channel_id: channel.id } });
    if (!instance) throw DiscordApiErrors.UNKNOWN_STAGE_INSTANCE;
    await StageInstance.delete({ id: instance.id });
    await emitEvent({ event: "STAGE_INSTANCE_DELETE", data: instance.toJSON(), guild_id: channel.guild_id });
    return res.sendStatus(204);
});

export default router;
