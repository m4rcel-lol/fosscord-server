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

import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";

export interface UserViolationAction {
    action_type: number; // ClassificationActionType
    descriptions: string[];
}

// a staff-issued violation, shown on the user's account standing page (discord calls these classifications)
@Entity({
    name: "user_violations",
})
export class UserViolation extends BaseClass {
    @Index("IDX_user_violation_user_id")
    @Column()
    user_id: string;

    @JoinColumn({ name: "user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "int" })
    classification_type: number; // ClassificationType

    @Column({ type: "text" })
    description: string;

    @Column({ type: "jsonb", default: [] })
    actions: UserViolationAction[] = [];

    @Column({ type: "jsonb", default: [] })
    flagged_content: unknown[] = [];

    // the staff member who issued it, kept even if they're later deleted
    @Column({ type: "int8", nullable: true })
    issued_by?: string | null;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    // clients treat a violation as active until this passes, so there's always one ("permanent" is far ahead)
    @Column({ type: "timestamptz" })
    expires_at: Date;

    @Column({ type: "int", nullable: true })
    appeal_status?: number | null; // AppealStatusValue, null until the user appeals

    @Column({ type: "timestamptz", nullable: true })
    appealed_at?: Date | null;

    // what the user said when appealing: the reason they picked (0 didn't break the rules, 1 too strict,
    // 2 disagree with the penalty, 3 something else) and their own words
    @Column({ type: "int", nullable: true })
    appeal_signal?: number | null;

    @Column({ type: "text", nullable: true })
    appeal_user_input?: string | null;

    // the review dms sent to staff, so votes on them can be matched back and they can all be marked resolved
    @Column({ type: "jsonb", default: [] })
    appeal_review_messages: { channel_id: string; message_id: string }[] = [];

    @Column({ type: "int8", nullable: true })
    appeal_resolved_by?: string | null;
}
