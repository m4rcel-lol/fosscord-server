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

import { In } from "typeorm";
import { Channel, Member, Message, Relationship, User, UserSettingsProtos } from "@spacebar/database";
import { ChannelCreateEvent, ChannelUpdateEvent, DiscordApiErrors, DmChannelDTO, emitEvent } from "@spacebar/util";
import { ChannelType, RelationshipType, UserFlags } from "@spacebar/schemas";

export async function assertCanSendDirectMessage(channel: Channel, senderId: string): Promise<string[]> {
    if (channel.type !== ChannelType.DM) return [];
    const recipientId = channel.recipients?.find((r) => r.user_id !== senderId)?.user_id;
    if (!recipientId) return [];
    const loaded = new Map(channel.recipients?.flatMap((r) => (r.user?.id === r.user_id ? [[r.user_id, r.user] as const] : [])));
    const findUser = (id: string) => (loaded.has(id) ? loaded.get(id)! : User.findOne({ where: { id }, select: { id: true, bot: true, system: true, flags: true } }));

    // the official and appeals accounts only send; nothing reads what's sent to them
    const target = await findUser(recipientId);
    if (target?.system || (Number(target?.flags ?? 0) & Number(UserFlags.FLAGS.SYSTEM)) !== 0) throw DiscordApiErrors.CANNOT_MESSAGE_USER;

    const relationships = await Relationship.find({
        where: [
            { from_id: senderId, to_id: recipientId },
            { from_id: recipientId, to_id: senderId },
        ],
    });
    if (relationships.some((r) => r.type === RelationshipType.BLOCKED)) throw DiscordApiErrors.CANNOT_MESSAGE_USER;
    if (relationships.some((r) => r.type === RelationshipType.FRIEND)) return [];

    const [sender, recipient] = await Promise.all([senderId, recipientId].map(findUser));
    if (!sender || !recipient || sender.system || recipient.system || recipient.bot) return [];

    const senderGuilds = (await Member.find({ where: { id: senderId }, select: { guild_id: true } })).map((m) => m.guild_id);
    if (!senderGuilds.length) throw DiscordApiErrors.CANNOT_MESSAGE_USER;
    const mutualGuilds = (await Member.find({ where: { id: recipientId, guild_id: In(senderGuilds) }, select: { guild_id: true } })).map((m) => m.guild_id);
    if (!mutualGuilds.length) throw DiscordApiErrors.CANNOT_MESSAGE_USER;

    const restricted = new Set((await UserSettingsProtos.findOne({ where: { user_id: recipientId } }))?.userSettings?.privacy?.restrictedGuildIds?.map(String) ?? []);
    if (mutualGuilds.every((id) => restricted.has(id))) throw DiscordApiErrors.CANNOT_MESSAGE_USER;
    return mutualGuilds.filter((id) => !restricted.has(id));
}

async function isMessageRequest(channelId: string, recipientId: string, senderId: string) {
    const friends = await Relationship.exists({ where: { from_id: recipientId, to_id: senderId, type: RelationshipType.FRIEND } });
    if (friends) return false;
    return !(await Message.exists({ where: { channel_id: channelId, author_id: recipientId } }));
}

// neverMessageRequest: for messages the server itself sends (official notices), which must not land in message requests
export async function reopenDirectMessage(
    channel: Channel,
    senderId: string,
    { neverMessageRequest = false, last_message_id }: { neverMessageRequest?: boolean; last_message_id?: string | null } = {},
) {
    if (!channel.isDm()) return;
    const sender = channel.recipients?.find((recipient) => recipient.user_id === senderId);
    const closed = channel.recipients?.filter((recipient) => recipient.closed) ?? [];
    if (!sender?.message_request_timestamp && !closed.length) return;
    const users = channel.recipients?.every((recipient) => recipient.user?.id === recipient.user_id)
        ? new Map(channel.recipients.map((recipient) => [recipient.user_id, recipient.user]))
        : undefined;
    const channelDto = await DmChannelDTO.from(channel, [], undefined, users);
    if (last_message_id !== undefined) channelDto.last_message_id = last_message_id;
    if (sender?.message_request_timestamp) {
        sender.message_request_timestamp = null;
        await Promise.all([
            sender.save(),
            emitEvent({
                event: "CHANNEL_UPDATE",
                data: { ...channelDto.excludedRecipients([senderId]), is_message_request: false, is_message_request_timestamp: null, is_spam: false },
                user_id: senderId,
            } as ChannelUpdateEvent),
        ]);
    }

    await Promise.all(
        closed.map(async (recipient) => {
            recipient.closed = false;
            if (!neverMessageRequest && channel.type === ChannelType.DM && recipient.user_id !== senderId && (await isMessageRequest(channel.id, recipient.user_id, senderId)))
                recipient.message_request_timestamp = new Date();
            await recipient.save();
            await emitEvent({
                event: "CHANNEL_CREATE",
                data: {
                    ...channelDto.excludedRecipients([recipient.user_id]),
                    is_message_request: !!recipient.message_request_timestamp,
                    is_message_request_timestamp: recipient.message_request_timestamp?.toISOString() ?? null,
                    is_spam: false,
                },
                user_id: recipient.user_id,
            } as ChannelCreateEvent);
        }),
    );
}
