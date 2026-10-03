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

import { MigrationInterface, QueryRunner } from "typeorm";

export class Reports1791397577282 implements MigrationInterface {
    name = "Reports1791397577282";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "reports" ("id" bigint NOT NULL, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'open', "reporter_id" bigint, "reported_user_id" bigint, "guild_id" bigint, "channel_id" bigint, "message_id" bigint, "application_id" bigint, "stage_instance_id" bigint, "guild_scheduled_event_id" bigint, "widget_id" character varying, "reason" text NOT NULL DEFAULT '', "breadcrumbs" jsonb NOT NULL DEFAULT '[]', "elements" jsonb NOT NULL DEFAULT '{}', "snapshot" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolved_by" bigint, "resolved_at" TIMESTAMP WITH TIME ZONE, "resolution_note" text, CONSTRAINT "PK_reports_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reports_status_created_at" ON "reports" ("status", "created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reports_reported_user_id" ON "reports" ("reported_user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "reports"`);
    }
}
