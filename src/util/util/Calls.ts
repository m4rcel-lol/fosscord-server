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

import { Channel, Message, Recipient, User, VoiceState } from "@spacebar/database";
import {
    CallCreateEvent,
    CallDeleteEvent,
    CallPayload,
    CallUpdateEvent,
    ChannelCreateEvent,
    Config,
    DmChannelDTO,
    emitEvent,
    MessageCreateEvent,
    MessageUpdateEvent,
} from "@spacebar/util";
import { ChannelType, MessageCallState, MessageType, PublicUserProjection } from "@spacebar/schemas";

const RING_TIMEOUT = 60_000;

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
};

const isPrivate = (channel: Channel | null): channel is Channel => channel?.type === ChannelType.DM || channel?.type === ChannelType.GROUP_DM;

async function activeCall(channel_id: string) {
    const message = await Message.findOne({ where: { channel_id, type: MessageType.CALL }, order: { id: "DESC" }, relations: { author: true } });
    if (!message?.call || message.call.ended_timestamp) return null;
    return message;
}

function payload(message: Message): CallPayload {
    const call = message.call as MessageCallState;
    return {
        channel_id: message.channel_id!,
        message_id: message.id,
        region: call.region ?? Config.get().regions.default,
        ringing: Object.keys(call.ringing ?? {}),
        ongoing_rings: { ...(call.ringing ?? {}) },
    };
}

async function voiceStates(channel_id: string) {
    return (await VoiceState.find({ where: { channel_id } })).map((x) => x.toPublicVoiceState());
}

async function recipientIds(channel_id: string) {
    return (await Recipient.find({ where: { channel_id }, select: { user_id: true } })).map((r) => r.user_id);
}

async function emitToRecipients(channel_id: string, build: (user_id: string) => Parameters<typeof emitEvent>[0]) {
    await Promise.all((await recipientIds(channel_id)).map((user_id) => emitEvent(build(user_id))));
}

async function saveCall(message: Message, call: MessageCallState, notifyMessage: boolean) {
    message.call = call;
    await Message.update({ id: message.id }, { call });
    if (notifyMessage) await emitEvent({ event: "MESSAGE_UPDATE", channel_id: message.channel_id, data: message.toJSON() } satisfies MessageUpdateEvent);
    await emitToRecipients(message.channel_id!, (user_id) => ({ event: "CALL_UPDATE", user_id, data: payload(message) }) satisfies CallUpdateEvent);
}

function scheduleRingTimeout(channel_id: string, user_ids: string[]) {
    if (!user_ids.length) return;
    setTimeout(
        () =>
            serial(async () => {
                try {
                    const message = await activeCall(channel_id);
                    if (!message?.call?.ringing) return;
                    const now = Date.now();
                    const expired = user_ids.filter((id) => message.call!.ringing![id] && now - (message.call!.ring_started?.[id] ?? 0) >= RING_TIMEOUT);
                    if (!expired.length) return;
                    const call = { ...message.call, ringing: { ...message.call.ringing }, ring_started: { ...message.call.ring_started } };
                    for (const id of expired) {
                        delete call.ringing[id];
                        delete call.ring_started[id];
                    }
                    await saveCall(message, call, false);
                } catch (e) {
                    console.error("[Calls] ring timeout failed", e);
                }
            }),
        RING_TIMEOUT + 500,
    ).unref?.();
}

async function reopenForRecipients(channel: Channel) {
    const closed = await Recipient.find({ where: { channel_id: channel.id, closed: true } });
    if (!closed.length) return;
    channel.recipients = await Recipient.find({ where: { channel_id: channel.id } });
    const dto = await DmChannelDTO.from(channel);
    for (const recipient of closed) {
        recipient.closed = false;
        await recipient.save();
        await emitEvent({ event: "CHANNEL_CREATE", user_id: recipient.user_id, data: dto.excludedRecipients([recipient.user_id]) } as ChannelCreateEvent);
    }
}

async function startCall(channel: Channel, user_id: string) {
    await reopenForRecipients(channel);
    const others = (await recipientIds(channel.id)).filter((id) => id !== user_id);
    const now = Date.now();
    const call: MessageCallState = {
        participants: [user_id],
        ended_timestamp: null,
        ringing: Object.fromEntries(others.map((id) => [id, user_id])),
        ring_started: Object.fromEntries(others.map((id) => [id, now])),
        region: Config.get().regions.default,
    };
    const message = Message.create({
        channel_id: channel.id,
        author_id: user_id,
        author: await User.findOneOrFail({ where: { id: user_id }, select: Object.fromEntries(PublicUserProjection.map((i) => [i, true])) }),
        type: MessageType.CALL,
        content: "",
        call,
        mentions: [],
        mention_roles: [],
        mention_channels: [],
        attachments: [],
        embeds: [],
        reactions: [],
        sticker_items: [],
        timestamp: new Date(),
        pinned: false,
        tts: false,
        mention_everyone: false,
    });
    await message.save();
    await Channel.update({ id: channel.id }, { last_message_id: message.id });
    await emitEvent({ event: "MESSAGE_CREATE", channel_id: channel.id, data: message.toJSON() } satisfies MessageCreateEvent);
    const states = await voiceStates(channel.id);
    await emitToRecipients(
        channel.id,
        (id) => ({ event: "CALL_CREATE", user_id: id, data: { ...payload(message), voice_states: states, embedded_activities: [] } }) satisfies CallCreateEvent,
    );
    scheduleRingTimeout(channel.id, others);
}

async function endCall(message: Message) {
    message.call = { ...(message.call as MessageCallState), ended_timestamp: new Date().toISOString(), ringing: {}, ring_started: {} };
    const { affected } = await Message.createQueryBuilder()
        .update()
        .set({ call: message.call })
        .where("id = :id AND (call->>'ended_timestamp') IS NULL", { id: message.id })
        .execute();
    if (!affected) return;
    await emitEvent({ event: "MESSAGE_UPDATE", channel_id: message.channel_id, data: message.toJSON() } satisfies MessageUpdateEvent);
    await emitToRecipients(message.channel_id!, (user_id) => ({ event: "CALL_DELETE", user_id, data: { channel_id: message.channel_id! } }) satisfies CallDeleteEvent);
}

export async function onPrivateVoiceStateChange(user_id: string, previous_channel_id: string | null | undefined, channel_id: string | null | undefined) {
    return serial(async () => {
        try {
            if (previous_channel_id && previous_channel_id !== channel_id) {
                const message = await activeCall(previous_channel_id);
                if (message && !(await VoiceState.exists({ where: { channel_id: previous_channel_id } }))) await endCall(message);
            }
            if (!channel_id || previous_channel_id === channel_id) return;
            const channel = await Channel.findOne({ where: { id: channel_id } });
            if (!isPrivate(channel)) return;

            const message = await activeCall(channel_id);
            if (!message) return await startCall(channel, user_id);

            const call = { ...(message.call as MessageCallState), ringing: { ...message.call!.ringing }, ring_started: { ...message.call!.ring_started } };
            const joined = !call.participants.includes(user_id);
            if (joined) call.participants = [...call.participants, user_id];
            delete call.ringing[user_id];
            delete call.ring_started[user_id];
            await saveCall(message, call, joined);
        } catch (e) {
            console.error("[Calls] voice state handling failed", e);
        }
    });
}

export async function ringCall(channel_id: string, user_id: string, recipients?: string[] | null) {
    return serial(async () => {
        const message = await activeCall(channel_id);
        if (!message) return false;
        const inVoice = new Set((await VoiceState.find({ where: { channel_id }, select: { user_id: true } })).map((x) => x.user_id));
        const targets = (recipients?.length ? recipients : await recipientIds(channel_id)).filter((id) => id !== user_id && !inVoice.has(id));
        const all = new Set(await recipientIds(channel_id));
        const call = { ...(message.call as MessageCallState), ringing: { ...message.call!.ringing }, ring_started: { ...message.call!.ring_started } };
        const now = Date.now();
        const rung = targets.filter((id) => all.has(id));
        for (const id of rung) {
            call.ringing[id] = user_id;
            call.ring_started[id] = now;
        }
        await saveCall(message, call, false);
        scheduleRingTimeout(channel_id, rung);
        return true;
    });
}

export async function stopRingingCall(channel_id: string, user_id: string, recipients?: string[] | null) {
    return serial(async () => {
        const message = await activeCall(channel_id);
        if (!message) return false;
        const targets = recipients?.length ? recipients : [user_id];
        const call = { ...(message.call as MessageCallState), ringing: { ...message.call!.ringing }, ring_started: { ...message.call!.ring_started } };
        for (const id of targets) {
            delete call.ringing[id];
            delete call.ring_started[id];
        }
        await saveCall(message, call, false);
        return true;
    });
}

export async function getActiveCallsFor(user_id: string) {
    const channels = (await Recipient.find({ where: { user_id, closed: false }, select: { channel_id: true } })).map((r) => r.channel_id);
    const states = channels.length ? await VoiceState.find({ where: channels.map((channel_id) => ({ channel_id })) }) : [];
    const active = [...new Set(states.map((s) => s.channel_id))];
    const calls: CallCreateEvent["data"][] = [];
    for (const channel_id of active) {
        const message = await activeCall(channel_id);
        if (message)
            calls.push({ ...payload(message), voice_states: states.filter((s) => s.channel_id === channel_id).map((s) => s.toPublicVoiceState()), embedded_activities: [] });
    }
    return calls;
}
