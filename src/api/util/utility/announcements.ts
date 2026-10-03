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

import { In } from "typeorm";
import { Attachment, Message, User } from "@spacebar/database";
import { deleteFile, emitEvent, MessageDeleteEvent } from "@spacebar/util";

// shared by the admin announcement routes; route files can't import each other, since the openapi generator files
// every route a module registers under whichever route file loaded it first

const CHUNK = 500;

/** Deletes announcement dms for everyone, with their attachment files. */
export async function deleteAnnouncementMessages(messages: Pick<Message, "id" | "channel_id">[]) {
    for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk = messages.slice(i, i + CHUNK);
        const ids = chunk.map((m) => m.id);
        // each dm has its own copy of the files; deleting the rows below doesn't remove them from storage
        const attachments = await Attachment.find({ where: { message_id: In(ids) } });
        for (const attachment of attachments)
            await deleteFile(new URL(attachment.toJSON().url).pathname).catch((e) => console.error(`[Announcement] couldn't delete file of attachment ${attachment.id}`, e));
        await Message.delete({ id: In(ids) });
        for (const message of chunk)
            await emitEvent({ event: "MESSAGE_DELETE", channel_id: message.channel_id!, data: { id: message.id, channel_id: message.channel_id! } } satisfies MessageDeleteEvent);
    }
}

export const serializeOfficial = (official: User) => ({
    id: official.id,
    username: official.username,
    discriminator: official.discriminator,
    global_name: official.global_name,
    avatar: official.avatar ?? null,
});
