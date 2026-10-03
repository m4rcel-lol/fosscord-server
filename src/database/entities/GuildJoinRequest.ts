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

import { Column, Entity, In, Index, IsNull, JoinColumn, ManyToOne } from "typeorm";
import { Snowflake } from "@spacebar/util/util/Snowflake";
import { BaseClass } from "./BaseClass";
import { Guild } from "./Guild";
import { User } from "./User";

export type GuildJoinRequestStatus = "STARTED" | "SUBMITTED" | "REJECTED" | "APPROVED";

@Entity({
    name: "guild_join_requests",
})
@Index("IDX_guild_join_requests_guild_user", ["guild_id", "user_id"], { unique: true })
@Index("IDX_guild_join_requests_guild_status", ["guild_id", "application_status"])
@Index("IDX_guild_join_requests_user_id", ["user_id"])
export class GuildJoinRequest extends BaseClass {
    @Column({ type: "int8" })
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_guild_join_requests_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild?: Guild;

    @Column({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_guild_join_requests_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user?: User;

    @Column({ type: "varchar", default: "STARTED" })
    application_status: GuildJoinRequestStatus = "STARTED";

    @Column({ type: "jsonb", default: [] })
    form_responses: Record<string, unknown>[] = [];

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date;

    @Column({ type: "timestamptz", nullable: true })
    actioned_at?: Date | null;

    @Column({ type: "int8", nullable: true })
    actioned_by_id?: string | null;

    @JoinColumn({ name: "actioned_by_id", foreignKeyConstraintName: "FK_guild_join_requests_actioned_by_id" })
    @ManyToOne(() => User, { onDelete: "SET NULL" })
    actioned_by?: User | null;

    @Column({ type: "text", nullable: true })
    rejection_reason?: string | null;

    @Column({ type: "timestamptz", nullable: true })
    last_seen?: Date | null;

    @Column({ type: "int8", nullable: true })
    interview_channel_id?: string | null;

    static activeForUser(user_id: string) {
        return GuildJoinRequest.find({
            where: [
                { user_id, application_status: In(["STARTED", "SUBMITTED", "REJECTED"]) },
                { user_id, application_status: "APPROVED", last_seen: IsNull() },
            ],
            order: { created_at: "DESC" },
        });
    }

    toJSON(scope: "self" | "moderator" = "self") {
        const actioned = this.actioned_at ? new Date(this.actioned_at) : null;
        const reviewed_at = actioned?.toISOString() ?? null;
        const full = scope === "moderator";
        return {
            id: this.id,
            join_request_id: this.id,
            created_at: new Date(this.created_at).toISOString(),
            application_status: this.application_status,
            guild_id: this.guild_id,
            user_id: this.user_id,
            last_seen: this.last_seen ? new Date(this.last_seen).toISOString() : null,
            rejection_reason: this.rejection_reason ?? null,
            interview_channel_id: this.interview_channel_id ?? null,
            actioned_at: actioned ? ((BigInt(actioned.getTime()) - BigInt(Snowflake.EPOCH)) << 22n).toString() : null,
            form_responses: this.form_responses,
            ...(full && {
                reviewed_at,
                actioned_by_user: this.actioned_by?.toPublicUser() ?? null,
            }),
            ...(this.user && { user: this.user.toPublicUser() }),
        };
    }
}
