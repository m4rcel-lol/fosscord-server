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

import { In } from "typeorm";
import { Channel, User } from "../../database/entities";
import { PublicUser, PublicUserProjection } from "@spacebar/schemas";

export class DmChannelDTO {
    icon: string | null;
    id: string;
    last_message_id: string | null;
    name: string | null;
    origin_channel_id: string | null;
    owner_id?: string;
    recipients: PublicUser[];
    type: number;

    static async from(channel: Channel, excluded_recipients: string[] = [], origin_channel_id?: string) {
        const obj = new DmChannelDTO();
        obj.icon = channel.icon || null;
        obj.id = channel.id;
        obj.last_message_id = channel.last_message_id || null;
        obj.name = channel.name || null;
        obj.origin_channel_id = origin_channel_id || null;
        obj.owner_id = channel.owner_id;
        obj.type = channel.type;
        const ids = channel.recipients?.map((r) => r.user_id).filter((id) => !excluded_recipients.includes(id)) ?? [];
        const users = ids.length ? await User.find({ where: { id: In(ids) }, select: Object.fromEntries(PublicUserProjection.map((i) => [i, true])) }) : [];
        obj.recipients = ids.flatMap((id) => users.find((u) => u.id === id)?.toPublicUser() ?? []);
        return obj;
    }

    excludedRecipients(excluded_recipients: string[]): DmChannelDTO {
        return {
            ...this,
            recipients: this.recipients.filter((r) => !excluded_recipients.includes(r.id)),
        };
    }
}
