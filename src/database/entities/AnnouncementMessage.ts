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

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Announcement } from "./Announcement";

// one dm an announcement was delivered as, so deleting the announcement can take the messages back
@Entity({
    name: "announcement_messages",
})
export class AnnouncementMessage extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8", foreignKeyConstraintName: "FK_announcement_messages_message_id" })
    message_id: string;

    @Column({ type: "int8" })
    channel_id: string;

    @Column({ type: "int8", foreignKeyConstraintName: "FK_announcement_messages_announcement_id" })
    @Index("IDX_announcement_messages_announcement_id")
    announcement_id: string;

    @JoinColumn({ name: "message_id", foreignKeyConstraintName: "FK_announcement_messages_message_id" })
    @ManyToOne(() => require("./Message").Message, { onDelete: "CASCADE" })
    message: import("./Message").Message;

    @JoinColumn({ name: "announcement_id", foreignKeyConstraintName: "FK_announcement_messages_announcement_id" })
    @ManyToOne(() => Announcement, { onDelete: "CASCADE" })
    announcement: Announcement;
}
