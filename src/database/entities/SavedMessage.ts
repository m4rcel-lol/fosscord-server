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

import { Column, Entity, JoinColumn, ManyToOne, Unique } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { Channel } from "./Channel";
import { Message } from "./Message";

@Entity({
    name: "saved_messages",
})
@Unique("UQ_saved_message_user_message", ["user_id", "message_id"])
export class SavedMessage extends BaseClass {
    @Column()
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_saved_message_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_saved_message_channel_id" })
    @ManyToOne(() => Channel, { onDelete: "CASCADE" })
    channel: Channel;

    @Column()
    message_id: string;

    @JoinColumn({ name: "message_id", foreignKeyConstraintName: "FK_saved_message_message_id" })
    @ManyToOne(() => Message, { onDelete: "CASCADE" })
    message: Message;

    @Column({ type: "timestamp with time zone" })
    saved_at: Date;

    @Column({ type: "timestamp with time zone", nullable: true })
    due_at: Date | null;

    @Column({ type: "varchar", nullable: true })
    notes: string | null;
}
