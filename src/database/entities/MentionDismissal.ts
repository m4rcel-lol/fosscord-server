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

import { BaseEntity, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Message } from "./Message";
import { User } from "./User";

@Entity({
    name: "mention_dismissals",
})
export class MentionDismissal extends BaseEntity {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @PrimaryColumn({ type: "int8" })
    message_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_mention_dismissal_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @JoinColumn({ name: "message_id", foreignKeyConstraintName: "FK_mention_dismissal_message_id" })
    @ManyToOne(() => Message, { onDelete: "CASCADE" })
    message: Message;
}
