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

import { LessThanOrEqual } from "typeorm";
import { Channel, ScheduledMessage, ScheduledMessagePayload, ScheduledMessageState, User } from "@spacebar/database";
import { Config, DiscordApiErrors, FieldErrors, getPermission, getRights, Snowflake } from "@spacebar/util";
import { MessageCreateSchema, MessageType } from "@spacebar/schemas";
import { MessageOptionAttachment } from "@spacebar/util/dtos/MessageOptions";
import { assertCanSendDirectMessage } from "./DirectMessage";
import { publishUserMessage } from "./UserMessage";
import { checkAutomod } from "../utility/automod";

export const SCHEDULED_MESSAGE_MIN_DELAY_MS = 600_000;
export const SCHEDULED_MESSAGE_MAX_DELAY_MS = 691_200_000;

export function validateScheduledSendAt(raw: unknown) {
    const send_at = new Date(String(raw));
    const delay = send_at.getTime() - Date.now();
    if (Number.isNaN(delay) || delay < SCHEDULED_MESSAGE_MIN_DELAY_MS - 60_000 || delay > SCHEDULED_MESSAGE_MAX_DELAY_MS + 60_000)
        throw FieldErrors({ scheduled_timestamp: { code: "BASE_TYPE_INVALID", message: "Scheduled messages must be sent between 10 minutes and 8 days from now." } });
    return send_at;
}

export function validateScheduledContent(payload: ScheduledMessagePayload) {
    const { maxCharacters } = Config.get().limits.message;
    if ((payload.content?.length ?? 0) > maxCharacters) throw FieldErrors({ content: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${maxCharacters} or fewer in length.` } });
    if (!payload.content?.trim() && !payload.attachments?.length && !payload.sticker_ids?.length && !payload.poll) throw DiscordApiErrors.CANNOT_SEND_EMPTY_MESSAGE;
}

export function scheduledMessageJSON(scheduled: ScheduledMessage, author: User, guild_id?: string | null) {
    const { payload } = scheduled;
    const send_at = scheduled.send_at.toISOString();
    const reply = !!payload.message_reference?.message_id;
    return {
        user_id: scheduled.user_id,
        scheduled_message_id: scheduled.id,
        send_at_timestamp: send_at,
        state: scheduled.state,
        create_args: {
            channel_id: scheduled.channel_id,
            content: payload.content ?? "",
            type: reply ? MessageType.REPLY : MessageType.DEFAULT,
            flags: payload.flags ?? 0,
            message_reference: payload.message_reference ?? null,
        },
        attachment_uploads: (payload.attachments ?? []).map(({ filename, uploaded_filename, description, title }) => ({ filename, uploaded_filename, description, title })),
        message_preview: {
            id: scheduled.id,
            channel_id: scheduled.channel_id,
            guild_id: guild_id ?? undefined,
            author: author.toPublicUser(),
            content: payload.content ?? "",
            type: reply ? MessageType.REPLY : MessageType.DEFAULT,
            flags: payload.flags ?? 0,
            timestamp: send_at,
            edited_timestamp: null,
            tts: false,
            pinned: false,
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: (payload.attachments ?? []).map((attachment, index) => ({
                id: `${index}`,
                filename: attachment.filename,
                size: 0,
                url: "",
                proxy_url: "",
                description: attachment.description,
            })),
            embeds: [],
            components: [],
            sticker_items: [],
            message_reference: payload.message_reference ?? undefined,
            poll: payload.poll ?? undefined,
        },
    };
}

export async function sendScheduledMessage(scheduled: ScheduledMessage) {
    const user = await User.findOne({ where: { id: scheduled.user_id } });
    if (!user) return ScheduledMessageState.ERROR_USER_NOT_FOUND;
    const channel = await Channel.findOne({ where: { id: scheduled.channel_id }, relations: { recipients: { user: true } } });
    if (!channel) return ScheduledMessageState.ERROR_CHANNEL_NOT_FOUND;
    try {
        const permission = await getPermission(user.id, channel.guild_id ?? undefined, channel);
        permission.hasThrow("VIEW_CHANNEL");
        permission.hasThrow(channel.isThread() ? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES");
        if (!(await getRights(user.id)).has("SEND_MESSAGES")) return ScheduledMessageState.ERROR_USER_CANNOT_USE_SCHEDULED_MESSAGES;
        if (!channel.isWritable()) return ScheduledMessageState.ERROR_CHANNEL_NOT_FOUND;
        await assertCanSendDirectMessage(channel, user.id);
        if (channel.guild_id) await checkAutomod({ guild_id: channel.guild_id, channel, user_id: user.id, content: scheduled.payload.content, permission });
        const body = { ...scheduled.payload } as MessageCreateSchema;
        await publishUserMessage({
            channel,
            user_id: user.id,
            body,
            message_id: Snowflake.generate(),
            attachments: (scheduled.payload.attachments ?? []) as MessageOptionAttachment[],
        });
        return null;
    } catch (error) {
        console.error(`[ScheduledMessages] failed to send ${scheduled.id}`, error);
        return ScheduledMessageState.ERROR_SEND_FAILED;
    }
}

export async function dispatchScheduledMessage(scheduled: ScheduledMessage) {
    const { affected } = await ScheduledMessage.delete({ id: scheduled.id, state: ScheduledMessageState.SCHEDULED });
    if (!affected) return false;
    const failure = await sendScheduledMessage(scheduled);
    if (failure === null) return true;
    await ScheduledMessage.insert({
        id: scheduled.id,
        user_id: scheduled.user_id,
        channel_id: scheduled.channel_id,
        send_at: scheduled.send_at,
        payload: scheduled.payload,
        state: failure,
    });
    return false;
}

async function sendDueScheduledMessages() {
    const due = await ScheduledMessage.find({ where: { state: ScheduledMessageState.SCHEDULED, send_at: LessThanOrEqual(new Date()) }, order: { send_at: "ASC" }, take: 100 });
    for (const scheduled of due) await dispatchScheduledMessage(scheduled);
}

export function startScheduledMessageSender() {
    const run = () => sendDueScheduledMessages().catch((e) => console.error("[ScheduledMessages] sender failed", e));
    setTimeout(run, 5_000);
    return setInterval(run, 15_000);
}
