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

import { emitEvent, Snowflake } from "@spacebar/util/util";

export interface StageInstance {
    id: string;
    guild_id: string;
    channel_id: string;
    topic: string;
    privacy_level: number;
    discoverable_disabled: boolean;
    guild_scheduled_event_id: string | null;
    invite_code: string | null;
}

const instances = new Map<string, StageInstance>();

export class StageInstances {
    static get(channelId: string) {
        return instances.get(channelId);
    }

    static forGuild(guildId: string) {
        return [...instances.values()].filter((instance) => instance.guild_id === guildId);
    }

    static async create(guildId: string, channelId: string, topic: string, privacyLevel = 2, scheduledEventId: string | null = null) {
        const instance: StageInstance = {
            id: Snowflake.generate(),
            guild_id: guildId,
            channel_id: channelId,
            topic,
            privacy_level: privacyLevel,
            discoverable_disabled: true,
            guild_scheduled_event_id: scheduledEventId,
            invite_code: null,
        };
        instances.set(channelId, instance);
        await emitEvent({ event: "STAGE_INSTANCE_CREATE", guild_id: guildId, data: instance });
        return instance;
    }

    static async update(channelId: string, changes: Partial<Pick<StageInstance, "topic" | "privacy_level">>) {
        const instance = instances.get(channelId);
        if (!instance) return undefined;
        Object.assign(instance, changes);
        await emitEvent({ event: "STAGE_INSTANCE_UPDATE", guild_id: instance.guild_id, data: instance });
        return instance;
    }

    static async delete(channelId: string) {
        const instance = instances.get(channelId);
        if (!instance) return;
        instances.delete(channelId);
        await emitEvent({ event: "STAGE_INSTANCE_DELETE", guild_id: instance.guild_id, data: instance });
    }
}
