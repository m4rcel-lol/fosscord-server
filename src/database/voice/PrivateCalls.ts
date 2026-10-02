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
import { MessageType } from "@spacebar/schemas";
import { Config, emitEvent } from "@spacebar/util/util";
import { MessageCreateEvent, MessageUpdateEvent } from "../../util/interfaces/Event";
import { Channel } from "../entities/Channel";
import { Message } from "../entities/Message";
import { Recipient } from "../entities/Recipient";
import { VoiceState } from "../entities/VoiceState";

const RING_TIMEOUT = 60_000;
const rings = new Map<string, Map<string, NodeJS.Timeout>>();

export class PrivateCalls {
    static async endStaleCalls() {
        await Message.createQueryBuilder()
            .update()
            .set({ call: () => `jsonb_set("call", '{ended_timestamp}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))` })
            .where(`"type" = :type AND "call" IS NOT NULL AND "call"->>'ended_timestamp' IS NULL`, { type: MessageType.CALL })
            .execute();
    }

    static region() {
        const { regions } = Config.get();
        return regions.available.find((region) => region.id === regions.default)?.id ?? regions.default;
    }

    static voiceStates(channelId: string) {
        return VoiceState.find({ where: { channel_id: channelId, guild_id: IsNull() } });
    }

    static async activeMessage(channelId: string) {
        const message = await Message.findOne({
            where: { channel_id: channelId, type: MessageType.CALL },
            order: { id: "DESC" },
            relations: { author: true },
        });
        return message?.call && message.call.ended_timestamp === null ? message : null;
    }

    static ringing(channelId: string) {
        return [...(rings.get(channelId)?.keys() ?? [])];
    }

    static payload(channelId: string, message: Message) {
        const ringing = PrivateCalls.ringing(channelId);
        return {
            channel_id: channelId,
            message_id: message.id,
            region: PrivateCalls.region(),
            ringing,
            ongoing_rings: Object.fromEntries(ringing.map((id) => [id, {}])),
        };
    }

    static async createPayload(channelId: string) {
        const message = await PrivateCalls.activeMessage(channelId);
        if (!message) return null;
        const states = await PrivateCalls.voiceStates(channelId);
        if (!states.length) return null;
        return { ...PrivateCalls.payload(channelId, message), voice_states: states.map((state) => state.toPublicVoiceState()), embedded_activities: [] };
    }

    private static async updateMessage(message: Message) {
        await message.save();
        await emitEvent({ event: "MESSAGE_UPDATE", channel_id: message.channel_id, data: message.toJSON() } satisfies MessageUpdateEvent);
    }

    static async join(channelId: string, userId: string) {
        const existing = await PrivateCalls.activeMessage(channelId);
        if (existing) {
            if (!existing.call!.participants.includes(userId)) {
                existing.call = { ...existing.call!, participants: [...existing.call!.participants, userId] };
                await PrivateCalls.updateMessage(existing);
            }
            await PrivateCalls.stopRinging(channelId, [userId]);
            return;
        }

        const message = Message.create({
            type: MessageType.CALL,
            channel_id: channelId,
            author_id: userId,
            content: "",
            timestamp: new Date(),
            call: { participants: [userId], ended_timestamp: null },
            attachments: [],
            embeds: [],
            reactions: [],
            sticker_items: [],
            mentions: [],
            mention_channels: [],
            mention_roles: [],
            mention_everyone: false,
        });
        await message.insert();
        const saved = await Message.findOneOrFail({ where: { id: message.id }, relations: { author: true } });
        await Channel.update({ id: channelId }, { last_message_id: saved.id });
        await emitEvent({ event: "MESSAGE_CREATE", channel_id: channelId, data: saved.toJSON() } satisfies MessageCreateEvent);
        await emitEvent({ event: "CALL_CREATE", channel_id: channelId, data: await PrivateCalls.createPayload(channelId) });
    }

    static async leave(channelId: string) {
        if ((await PrivateCalls.voiceStates(channelId)).length) return;
        for (const timer of rings.get(channelId)?.values() ?? []) clearTimeout(timer);
        rings.delete(channelId);
        const message = await PrivateCalls.activeMessage(channelId);
        if (message) {
            message.call = { ...message.call!, ended_timestamp: new Date().toISOString() };
            await PrivateCalls.updateMessage(message);
        }
        await emitEvent({ event: "CALL_DELETE", channel_id: channelId, data: { channel_id: channelId } });
    }

    private static async update(channelId: string) {
        const message = await PrivateCalls.activeMessage(channelId);
        if (message) await emitEvent({ event: "CALL_UPDATE", channel_id: channelId, data: PrivateCalls.payload(channelId, message) });
    }

    static async ring(channelId: string, ringerId: string, recipients?: string[] | null) {
        if (!(await PrivateCalls.activeMessage(channelId))) return;
        const inCall = new Set((await PrivateCalls.voiceStates(channelId)).map((state) => state.user_id));
        const members = (await Recipient.find({ where: { channel_id: channelId } })).map((recipient) => recipient.user_id);
        const targets = members.filter((id) => id !== ringerId && !inCall.has(id) && (!recipients?.length || recipients.includes(id)));
        if (!targets.length) return;

        let channelRings = rings.get(channelId);
        if (!channelRings) rings.set(channelId, (channelRings = new Map()));
        for (const id of targets) {
            clearTimeout(channelRings.get(id));
            channelRings.set(
                id,
                setTimeout(() => PrivateCalls.stopRinging(channelId, [id]), RING_TIMEOUT),
            );
        }
        await PrivateCalls.update(channelId);
    }

    static async stopRinging(channelId: string, recipients?: string[] | null) {
        const channelRings = rings.get(channelId);
        if (!channelRings) return;
        const targets = recipients?.length ? recipients : [...channelRings.keys()];
        let changed = false;
        for (const id of targets) {
            if (!channelRings.has(id)) continue;
            clearTimeout(channelRings.get(id));
            channelRings.delete(id);
            changed = true;
        }
        if (!channelRings.size) rings.delete(channelId);
        if (changed) await PrivateCalls.update(channelId);
    }
}
