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
import { Channel, VoiceChannels, VoiceState } from "@spacebar/database";
import { DiscordApiErrors, getPermission } from "@spacebar/util";
import { ChannelType, VoiceStateModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });
//TODO need more testing when community guild and voice stage channel are working

router.patch(
    "/",
    route({
        requestBody: "VoiceStateModifySchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as VoiceStateModifySchema;
        const { guild_id } = req.params as { [key: string]: string };
        const self = req.params.user_id === "@me" || req.params.user_id === req.user_id;
        const user_id = self ? req.user_id : (req.params.user_id as string);

        const voiceState = await VoiceState.findOne({ where: { guild_id, user_id } });
        if (!voiceState?.channel_id || (body.channel_id && body.channel_id !== voiceState.channel_id)) throw DiscordApiErrors.UNKNOWN_VOICE_STATE;
        const channel = await Channel.findOneOrFail({ where: { guild_id, id: voiceState.channel_id } });
        if (channel.type !== ChannelType.GUILD_STAGE_VOICE) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
        const perms = await getPermission(req.user_id, guild_id, channel.id);

        if (self) {
            if ("request_to_speak_timestamp" in body) {
                if (body.request_to_speak_timestamp) perms.hasThrow("REQUEST_TO_SPEAK");
                voiceState.request_to_speak_timestamp = body.request_to_speak_timestamp ? new Date(body.request_to_speak_timestamp) : (null as unknown as undefined);
            }
            if (body.suppress === false && voiceState.suppress) perms.hasThrow("MUTE_MEMBERS");
            if (body.suppress !== undefined) voiceState.suppress = body.suppress;
        } else {
            perms.hasThrow("MUTE_MEMBERS");
            if (body.suppress === false) {
                voiceState.request_to_speak_timestamp = (voiceState.request_to_speak_timestamp ? null : new Date()) as unknown as undefined;
                voiceState.suppress = false;
            } else if (body.suppress === true) {
                voiceState.suppress = true;
                voiceState.request_to_speak_timestamp = null as unknown as undefined;
            }
        }

        await voiceState.save();
        await VoiceChannels.publish(voiceState);
        return res.sendStatus(204);
    },
);

export default router;
