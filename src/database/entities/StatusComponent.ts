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

import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";

export type StatusComponentStatus = "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";

@Entity({
    name: "status_components",
})
export class StatusComponent extends BaseClass {
    @Column()
    name: string;

    @Column({ type: "text", nullable: true })
    description?: string | null;

    @Column({ type: "varchar", default: "operational" })
    status: StatusComponentStatus = "operational";

    @Column({ default: 0 })
    position: number = 0;

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();
}
