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
import { Guild } from "./Guild";
import { User } from "./User";

export enum GuildScheduledEventStatus {
    SCHEDULED = 1,
    ACTIVE = 2,
    COMPLETED = 3,
    CANCELED = 4,
}

export enum GuildScheduledEventEntityType {
    STAGE_INSTANCE = 1,
    VOICE = 2,
    EXTERNAL = 3,
}

export interface GuildScheduledEventException {
    event_exception_id: string;
    event_id: string;
    guild_id: string;
    original_scheduled_start_time: string;
    scheduled_start_time: string | null;
    scheduled_end_time: string | null;
    is_canceled: boolean;
}

@Entity({ name: "guild_scheduled_events" })
export class GuildScheduledEvent extends BaseClass {
    @Column({ type: "int8" })
    @Index("IDX_guild_scheduled_events_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_guild_scheduled_event_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild: Guild;

    @Column({ type: "int8", nullable: true })
    channel_id: string | null;

    @Column({ type: "int8", nullable: true })
    creator_id: string | null;

    @JoinColumn({ name: "creator_id", foreignKeyConstraintName: "FK_guild_scheduled_event_creator_id" })
    @ManyToOne(() => User, { onDelete: "SET NULL" })
    creator?: User;

    @Column()
    name: string;

    @Column({ type: "text", nullable: true })
    description: string | null;

    @Column({ type: "timestamptz" })
    scheduled_start_time: Date;

    @Column({ type: "timestamptz", nullable: true })
    scheduled_end_time: Date | null;

    @Column({ type: "int", default: 2 })
    privacy_level: number;

    @Column({ type: "int", default: GuildScheduledEventStatus.SCHEDULED })
    status: GuildScheduledEventStatus;

    @Column({ type: "int" })
    entity_type: GuildScheduledEventEntityType;

    @Column({ type: "int8", nullable: true })
    entity_id: string | null;

    @Column({ type: "jsonb", nullable: true })
    entity_metadata: { location?: string } | null;

    @Column({ type: "varchar", nullable: true })
    image: string | null;

    @Column({ type: "jsonb", nullable: true })
    recurrence_rule: Record<string, unknown> | null;

    @Column({ type: "jsonb", default: [] })
    exceptions: GuildScheduledEventException[];

    @Column({ default: false })
    auto_start: boolean;

    toJSON(userCount?: number) {
        return {
            id: this.id,
            guild_id: this.guild_id,
            channel_id: this.channel_id ?? null,
            creator_id: this.creator_id ?? null,
            ...(this.creator ? { creator: this.creator.toPublicUser() } : {}),
            name: this.name,
            description: this.description ?? null,
            scheduled_start_time: new Date(this.scheduled_start_time).toISOString(),
            scheduled_end_time: this.scheduled_end_time ? new Date(this.scheduled_end_time).toISOString() : null,
            auto_start: this.auto_start,
            privacy_level: this.privacy_level,
            status: this.status,
            entity_type: this.entity_type,
            entity_id: this.entity_id ?? null,
            entity_metadata: this.entity_metadata ?? null,
            sku_ids: [],
            image: this.image ?? null,
            recurrence_rule: this.recurrence_rule ?? null,
            guild_scheduled_event_exceptions: this.exceptions ?? [],
            ...(userCount !== undefined ? { user_count: userCount } : {}),
        };
    }
}

@Entity({ name: "guild_scheduled_event_users" })
@Index("IDX_guild_scheduled_event_users_event_user", ["guild_scheduled_event_id", "user_id"])
export class GuildScheduledEventUser extends BaseClass {
    @Column({ type: "int8" })
    guild_scheduled_event_id: string;

    @JoinColumn({ name: "guild_scheduled_event_id", foreignKeyConstraintName: "FK_guild_scheduled_event_user_event_id" })
    @ManyToOne(() => GuildScheduledEvent, { onDelete: "CASCADE" })
    event: GuildScheduledEvent;

    @Column({ type: "int8" })
    @Index("IDX_guild_scheduled_event_users_user_id")
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_guild_scheduled_event_user_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user?: User;

    @Column({ type: "int8" })
    guild_id: string;

    @Column({ type: "int8", nullable: true })
    guild_scheduled_event_exception_id: string | null;

    @Column({ type: "int", default: 1 })
    response: number;

    toJSON() {
        return {
            guild_scheduled_event_id: this.guild_scheduled_event_id,
            guild_scheduled_event_exception_id: this.guild_scheduled_event_exception_id ?? null,
            user_id: this.user_id,
            response: this.response,
        };
    }
}
