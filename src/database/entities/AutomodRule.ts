/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2024 Spacebar and Spacebar Contributors

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

import { BaseClass } from "./BaseClass";
import { Entity, JoinColumn, ManyToOne, Column, Index } from "typeorm";
import { User } from "./User";
import { AutomodAction, AutomodRuleEventType, AutomodRuleTriggerMetadata, AutomodRuleTriggerType } from "@spacebar/schemas";

@Entity({
    name: "automod_rules",
})
export class AutomodRule extends BaseClass {
    @Column({ type: "int8", nullable: true })
    creator_id?: string | null;

    @JoinColumn({ name: "creator_id", foreignKeyConstraintName: "FK_automod_rule_creator_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    creator: User;

    @Column()
    enabled: boolean;

    @Column()
    event_type: AutomodRuleEventType;

    @Column({ type: "int8", array: true })
    exempt_channels: string[];

    @Column({ type: "int8", array: true })
    exempt_roles: string[];

    @Index("IDX_automod_rules_guild_id")
    @Column({ type: "int8" })
    guild_id: string;

    @Column()
    name: string;

    @Column()
    position: number;

    @Column()
    trigger_type: AutomodRuleTriggerType;

    @Column({
        type: "jsonb",
        nullable: true,
    })
    trigger_metadata?: AutomodRuleTriggerMetadata | null;

    @Column({
        type: "jsonb",
    })
    actions: AutomodAction[];

    toJSON() {
        return {
            id: this.id,
            guild_id: this.guild_id,
            name: this.name,
            creator_id: this.creator_id ?? null,
            event_type: this.event_type,
            trigger_type: this.trigger_type,
            trigger_metadata: this.trigger_metadata ?? {},
            actions: this.actions,
            enabled: this.enabled,
            exempt_roles: this.exempt_roles ?? [],
            exempt_channels: this.exempt_channels ?? [],
            position: this.position,
        };
    }
}
