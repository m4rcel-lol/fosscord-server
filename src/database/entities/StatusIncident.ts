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

import { Column, Entity, Index } from "typeorm";
import { BaseClass } from "./BaseClass";

export type StatusIncidentImpact = "none" | "minor" | "major" | "critical" | "maintenance";
export type StatusIncidentState = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled" | "in_progress" | "verifying" | "completed";

export const RESOLVED_INCIDENT_STATES: StatusIncidentState[] = ["resolved", "completed"];

export interface StatusIncidentUpdate {
    id: string;
    status: StatusIncidentState;
    body: string;
    created_at: string;
}

@Entity({
    name: "status_incidents",
})
export class StatusIncident extends BaseClass {
    @Column()
    name: string;

    @Column({ type: "varchar", default: "none" })
    impact: StatusIncidentImpact = "none";

    @Index("IDX_status_incident_status")
    @Column({ type: "varchar", default: "investigating" })
    status: StatusIncidentState = "investigating";

    @Column({ type: "jsonb", default: [] })
    updates: StatusIncidentUpdate[] = [];

    @Column({ type: "int8", array: true, default: [] })
    component_ids: string[] = [];

    // maintenance windows only
    @Column({ type: "timestamptz", nullable: true })
    scheduled_for?: Date | null;

    @Column({ type: "timestamptz", nullable: true })
    scheduled_until?: Date | null;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();

    @Column({ type: "timestamptz", nullable: true })
    resolved_at?: Date | null;

    get is_maintenance() {
        return this.impact === "maintenance";
    }
}
