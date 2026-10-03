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

import { setTimeout as sleep } from "node:timers/promises";
import { Request, Response, Router } from "express";
import { Not, IsNull } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { VoiceState } from "@spacebar/database";
import { Config, VoiceHealth } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Voice server and SFU health" }), async (req: Request, res: Response) => {
    const [health, states] = await Promise.all([
        Promise.race([VoiceHealth.snapshot(), sleep(3000, "timeout" as const, { ref: false })]).catch((e: Error) => e),
        VoiceState.find({ where: { channel_id: Not(IsNull()) }, select: { user_id: true, channel_id: true, guild_id: true, self_video: true, self_stream: true } }),
    ]);
    const { regions } = Config.get();
    res.json({
        in_process: health !== null,
        server:
            health === "timeout"
                ? { enabled: true, library: null, reason: "The voice server didn't answer within 3 seconds" }
                : health instanceof Error
                  ? { enabled: true, library: null, reason: health.message }
                  : health,
        voice_states: {
            users: states.length,
            channels: new Set(states.map((s) => s.channel_id)).size,
            dm_calls: new Set(states.filter((s) => !s.guild_id).map((s) => s.channel_id)).size,
            video: states.filter((s) => s.self_video).length,
            streams: states.filter((s) => s.self_stream).length,
        },
        regions: { default: regions.default, available: regions.available.map((r) => ({ id: r.id, name: r.name, endpoint: r.endpoint, deprecated: !!r.deprecated })) },
    });
});

export default router;
