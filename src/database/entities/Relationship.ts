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

import { Column, Entity, In, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { PartialRelationshipSchema, RelationshipSchema, RelationshipType } from "@spacebar/schemas";

@Entity({
    name: "relationships",
})
@Index(["from_id", "to_id"], { unique: true })
export class Relationship extends BaseClass {
    @Column({})
    from_id: string;

    @JoinColumn({ name: "from_id", foreignKeyConstraintName: "FK_relationship_from_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    from: User;

    @Column({})
    @Index("IDX_relationships_to_id")
    to_id: string;

    @JoinColumn({ name: "to_id", foreignKeyConstraintName: "FK_relationship_to_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    to: User;

    @Column({ nullable: true })
    nickname?: string;

    @Column({ type: "int" })
    type: RelationshipType;

    @Column()
    user_ignored: boolean;

    @Column({ type: "varchar", nullable: true })
    note?: string | null;

    @Column({ nullable: true })
    stranger_request?: boolean;

    @Column({ nullable: true })
    is_spam_request: boolean;

    @Column({ nullable: true, type: "timestamp with time zone" })
    since?: Date;

    /** Whether either user blocked the other. */
    static async isBlockedBetween(a: string, b: string) {
        return Relationship.exists({
            where: [
                { from_id: a, to_id: b, type: RelationshipType.BLOCKED },
                { from_id: b, to_id: a, type: RelationshipType.BLOCKED },
            ],
        });
    }

    /** The users among others who blocked userId, or whom userId blocked. */
    static async blockedAmong(userId: string, others: string[]) {
        if (!others.length) return new Set<string>();
        const rows = await Relationship.find({
            where: [
                { from_id: userId, to_id: In(others), type: RelationshipType.BLOCKED },
                { from_id: In(others), to_id: userId, type: RelationshipType.BLOCKED },
            ],
            select: { from_id: true, to_id: true },
        });
        return new Set(rows.map((row) => (row.from_id === userId ? row.to_id : row.from_id)));
    }

    toPublicRelationship() {
        return {
            id: this.to?.id || this.to_id,
            type: this.type,
            nickname: this.nickname ?? null,
            user: this.to?.toPartialUser(),
            user_ignored: this.user_ignored,
            note: this.note ?? undefined,
            stranger_request: this.stranger_request,
            is_spam_request: this.is_spam_request,
            origin_application_id: undefined, // we dont support this oauth behavior yet
            since: this.since,
        } satisfies RelationshipSchema;
    }

    toPartialRelationship(): PartialRelationshipSchema {
        return {
            id: this.to?.id ?? this.to_id,
            nickname: this.nickname ?? null,
            type: this.type,
            user_ignored: this.user_ignored,
            since: this.since,
            stranger_request: this.stranger_request,
        } satisfies PartialRelationshipSchema;
    }
}
