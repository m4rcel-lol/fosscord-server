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

import { Channel, Message, SavedMessage } from "@spacebar/database";
import { getPermission } from "@spacebar/util";

export const savedMessageRelations = {
    author: true,
    webhook: true,
    application: true,
    mentions: true,
    mention_roles: true,
    mention_channels: true,
    sticker_items: true,
    attachments: true,
    channel: { recipients: { user: true } },
} as const;

export async function canReadMessage(userId: string, message: Message) {
    try {
        const permissions = await getPermission(userId, message.guild_id ?? undefined, message.channel_id);
        return permissions.has("VIEW_CHANNEL") && (message.author_id === userId || permissions.has("READ_MESSAGE_HISTORY"));
    } catch {
        return false;
    }
}

function channelSummary(channel: Channel | undefined, userId: string) {
    if (!channel) return "";
    if (channel.name) return channel.name;
    return (channel.recipients ?? [])
        .filter((recipient) => recipient.user_id !== userId)
        .map((recipient) => recipient.user?.global_name ?? recipient.user?.username)
        .filter(Boolean)
        .join(", ");
}

export function savedMessageResult(saved: SavedMessage, message: Message | null, userId: string) {
    const author = message?.author;
    return {
        message: message ? message.toPublicJSON(userId) : null,
        save_data: {
            channel_id: saved.channel_id,
            message_id: saved.message_id,
            saved_at: saved.saved_at.toISOString(),
            due_at: saved.due_at?.toISOString() ?? null,
            notes: saved.notes ?? "",
            guild_id: message?.guild_id ?? 0,
            author_id: message?.author_id ?? 0,
            author_summary: author?.global_name ?? author?.username ?? message?.webhook?.name ?? "",
            channel_summary: channelSummary(message?.channel, userId),
            message_summary: (message?.content || message?.attachments?.[0]?.filename || "").slice(0, 200),
        },
    };
}
