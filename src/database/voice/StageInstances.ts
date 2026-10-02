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

import { IsNull } from "typeorm";
import { emitEvent } from "@spacebar/util/util";
import { StageInstance } from "../entities/StageInstance";
import { VoiceState } from "../entities/VoiceState";
import { ScheduledEvents } from "./ScheduledEvents";

export class StageInstances {
    static emptyTimeout = 5 * 60 * 1000;
    private static emptyTimers = new Map<string, NodeJS.Timeout>();

    static get(channelId: string) {
        return StageInstance.findOne({ where: { channel_id: channelId } });
    }

    static async create(guildId: string, channelId: string, topic: string, privacyLevel = 2, scheduledEventId: string | null = null, notifyHostId: string | null = null) {
        const instance = await StageInstance.create({
            guild_id: guildId,
            channel_id: channelId,
            topic,
            privacy_level: privacyLevel,
            guild_scheduled_event_id: scheduledEventId,
        }).save();
        await emitEvent({ event: "STAGE_INSTANCE_CREATE", guild_id: guildId, data: instance.toJSON() });
        if (notifyHostId)
            await emitEvent({ event: "STAGE_INSTANCE_UPDATE", guild_id: guildId, data: { ...instance.toJSON(), host_id: notifyHostId, send_start_notification: true } });
        await ScheduledEvents.stageStarted(scheduledEventId, guildId, instance.id);
        await StageInstances.speakersChanged(channelId);
        return instance.toJSON();
    }

    static async speakersChanged(channelId: string) {
        if (!(await StageInstances.get(channelId))) return StageInstances.cancelEmptyTimer(channelId);
        if (await VoiceState.exists({ where: { channel_id: channelId, suppress: false, request_to_speak_timestamp: IsNull() } })) return StageInstances.cancelEmptyTimer(channelId);
        if (StageInstances.emptyTimers.has(channelId)) return;
        const timer = setTimeout(() => {
            StageInstances.emptyTimers.delete(channelId);
            VoiceState.exists({ where: { channel_id: channelId, suppress: false, request_to_speak_timestamp: IsNull() } })
                .then((hasSpeakers) => (hasSpeakers ? undefined : StageInstances.delete(channelId)))
                .catch((e) => console.error("[StageInstances] Error ending stage without speakers:", e));
        }, StageInstances.emptyTimeout);
        timer.unref?.();
        StageInstances.emptyTimers.set(channelId, timer);
    }

    private static cancelEmptyTimer(channelId: string) {
        clearTimeout(StageInstances.emptyTimers.get(channelId));
        StageInstances.emptyTimers.delete(channelId);
    }

    static async update(channelId: string, changes: Partial<Pick<StageInstance, "topic" | "privacy_level">>) {
        const instance = await StageInstances.get(channelId);
        if (!instance) return undefined;
        Object.assign(instance, changes);
        await instance.save();
        await emitEvent({ event: "STAGE_INSTANCE_UPDATE", guild_id: instance.guild_id, data: instance.toJSON() });
        return instance.toJSON();
    }

    static async delete(channelId: string) {
        const instance = await StageInstances.get(channelId);
        StageInstances.cancelEmptyTimer(channelId);
        if (!instance) return;
        await StageInstance.delete({ id: instance.id });
        await emitEvent({ event: "STAGE_INSTANCE_DELETE", guild_id: instance.guild_id, data: instance.toJSON() });
        await ScheduledEvents.channelEnded(channelId);
    }

    static async clear() {
        await StageInstance.createQueryBuilder().delete().execute();
    }
}
