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
import { Channel } from "./Channel";
import { Guild } from "./Guild";

@Entity({ name: "stage_instances" })
export class StageInstance extends BaseClass {
    @Column({ type: "int8" })
    @Index("IDX_stage_instances_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_stage_instance_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild: Guild;

    @Column({ type: "int8", unique: true })
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_stage_instance_channel_id" })
    @ManyToOne(() => Channel, { onDelete: "CASCADE" })
    channel: Channel;

    @Column()
    topic: string;

    @Column({ type: "int", default: 2 })
    privacy_level: number;

    @Column({ type: "int8", nullable: true })
    guild_scheduled_event_id?: string | null;

    toJSON() {
        return {
            id: this.id,
            guild_id: this.guild_id,
            channel_id: this.channel_id,
            topic: this.topic,
            privacy_level: this.privacy_level,
            discoverable_disabled: true,
            guild_scheduled_event_id: this.guild_scheduled_event_id ?? null,
            invite_code: null,
        };
    }
}
