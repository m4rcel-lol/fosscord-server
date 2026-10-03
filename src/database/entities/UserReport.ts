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

export enum UserReportStatus {
    OPEN = 0,
    ACTIONED = 1,
    DISMISSED = 2,
}

export interface UserReportSnapshot {
    content?: string;
    author_id?: string;
    attachments?: { id: string; url: string; filename: string; content_type?: string | null }[];
    embeds?: number;
    timestamp?: string;
}

@Entity({
    name: "user_reports",
})
@Index("IDX_user_reports_status", ["status", "id"])
export class UserReport extends BaseClass {
    @Column()
    type: string;

    @Index("IDX_user_reports_reporter_id")
    @Column({ type: "int8", nullable: true })
    reporter_id?: string | null;

    @Index("IDX_user_reports_reported_user_id")
    @Column({ type: "int8", nullable: true })
    reported_user_id?: string | null;

    @Column({ type: "int8", nullable: true })
    guild_id?: string | null;

    @Column({ type: "int8", nullable: true })
    channel_id?: string | null;

    @Column({ type: "int8", nullable: true })
    message_id?: string | null;

    @Column({ type: "jsonb", default: [] })
    breadcrumbs: number[] = [];

    @Column({ type: "jsonb", default: {} })
    elements: Record<string, string[]> = {};

    @Column({ type: "jsonb", nullable: true })
    snapshot?: UserReportSnapshot | null;

    @Column({ type: "int", default: UserReportStatus.OPEN })
    status: UserReportStatus = UserReportStatus.OPEN;

    @Column({ type: "int8", nullable: true })
    resolved_by?: string | null;

    @Column({ type: "timestamptz", nullable: true })
    resolved_at?: Date | null;

    @Column({ type: "int8", nullable: true })
    violation_id?: string | null;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();
}
