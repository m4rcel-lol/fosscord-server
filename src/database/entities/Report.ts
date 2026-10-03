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

export type ReportStatus = "open" | "resolved" | "dismissed";

export interface ReportSnapshot {
    author?: { id: string; username: string; discriminator?: string; global_name?: string | null; avatar?: string | null };
    author_id?: string;
    content?: string;
    attachments?: { id?: string; filename: string; url: string; content_type?: string | null }[];
    embeds?: number;
    sent_at?: string;
    name?: string;
}

@Entity({
    name: "reports",
})
@Index("IDX_reports_status_created_at", ["status", "created_at"])
export class Report extends BaseClass {
    @Column()
    type: string;

    @Column({ default: "open" })
    status: ReportStatus = "open";

    @Column({ type: "int8", nullable: true })
    reporter_id?: string | null;

    @Index("IDX_reports_reported_user_id")
    @Column({ type: "int8", nullable: true })
    reported_user_id?: string | null;

    @Column({ type: "int8", nullable: true })
    guild_id?: string | null;

    @Column({ type: "int8", nullable: true })
    channel_id?: string | null;

    @Column({ type: "int8", nullable: true })
    message_id?: string | null;

    @Column({ type: "int8", nullable: true })
    application_id?: string | null;

    @Column({ type: "int8", nullable: true })
    stage_instance_id?: string | null;

    @Column({ type: "int8", nullable: true })
    guild_scheduled_event_id?: string | null;

    @Column({ type: "varchar", nullable: true })
    widget_id?: string | null;

    @Column({ type: "text", default: "" })
    reason: string = "";

    @Column({ type: "jsonb", default: [] })
    breadcrumbs: number[] = [];

    @Column({ type: "jsonb", default: {} })
    elements: Record<string, string[] | string> = {};

    @Column({ type: "jsonb", nullable: true })
    snapshot?: ReportSnapshot | null;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    @Column({ type: "int8", nullable: true })
    resolved_by?: string | null;

    @Column({ type: "timestamptz", nullable: true })
    resolved_at?: Date | null;

    @Column({ type: "text", nullable: true })
    resolution_note?: string | null;

    @Column({ type: "int8", nullable: true })
    violation_id?: string | null;
}
