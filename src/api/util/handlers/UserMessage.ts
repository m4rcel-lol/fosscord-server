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

import { Channel, Member, ReadState } from "@spacebar/database";
import { emitEvent, MessageCreateEvent, Permissions } from "@spacebar/util";
import { MessageOptionAttachment } from "@spacebar/util/dtos/MessageOptions";
import { MessageCreateSchema } from "@spacebar/schemas";
import { handleMessage, postHandleMessage } from "./Message";
import { reopenDirectMessage } from "./DirectMessage";
import { onThreadMessage } from "./Thread";

export async function publishUserMessage(opts: {
    channel: Channel;
    user_id: string;
    body: MessageCreateSchema;
    message_id: string;
    attachments: MessageOptionAttachment[];
    permission?: Permissions;
}) {
    const { channel, user_id, body, message_id, attachments, permission } = opts;
    const last_message_id = channel.last_message_id || null;
    const embeds = body.embeds || [];
    if (body.embed) embeds.push(body.embed);
    const message = await handleMessage(
        {
            ...body,
            id: message_id,
            type: 0,
            pinned: false,
            author_id: user_id,
            embeds,
            channel_id: channel.id,
            attachments,
            timestamp: new Date(),
        },
        { channel, permission },
    );
    Object.assign(message, { edited_timestamp: null });

    await reopenDirectMessage(channel, user_id, { last_message_id });

    if (channel.isThread())
        await onThreadMessage(
            channel,
            user_id,
            message.mentions?.map((user) => user.id),
        );

    if (message.guild_id) {
        if (!message.member) {
            message.member = await Member.findOneOrFail({
                where: { id: user_id, guild_id: message.guild_id },
                relations: { roles: true },
            });
            message.member.clean_data();
        }

        Object.assign(message.member, { roles: message.member.roles.filter((x) => x.id != x.guild_id).map((x) => x.id) });
    }

    const read_state = await ReadState.findOne({ where: { user_id, channel_id: channel.id }, select: { id: true } });

    await Promise.all([
        read_state
            ? ReadState.update({ id: read_state.id }, { last_message_id: message.id, mention_count: 0 })
            : ReadState.create({ user_id, channel_id: channel.id, last_message_id: message.id, mention_count: 0 }).save(),
        message.save(),
        message.guild_id ? Member.update({ id: user_id, guild_id: message.guild_id }, { last_message_id: message.id }) : undefined,
    ]);
    await emitEvent({
        event: "MESSAGE_CREATE",
        channel_id: channel.id,
        data: { ...message.toJSON(), nonce: message.nonce ?? undefined },
    } satisfies MessageCreateEvent);

    postHandleMessage(message, permission).catch((e) => console.error("[Message] post-message handler failed", e));
    return message;
}
