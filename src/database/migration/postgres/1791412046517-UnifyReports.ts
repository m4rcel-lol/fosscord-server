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

export class UnifyReports1791412046517 implements MigrationInterface {
    name = "UnifyReports1791412046517";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "violation_id" bigint`);
        const [{ exists }] = await queryRunner.query(`SELECT to_regclass('public.user_reports') IS NOT NULL AS "exists"`);
        if (!exists) return;
        await queryRunner.query(
            `INSERT INTO "reports" ("id", "type", "status", "reporter_id", "reported_user_id", "guild_id", "channel_id", "message_id", "breadcrumbs", "elements", "snapshot", "created_at", "resolved_by", "resolved_at", "violation_id")
            SELECT "id", "type",
                CASE "status" WHEN 1 THEN 'resolved' WHEN 2 THEN 'dismissed' ELSE 'open' END,
                "reporter_id", "reported_user_id", "guild_id", "channel_id", "message_id", "breadcrumbs", "elements",
                CASE WHEN "snapshot" IS NULL THEN NULL WHEN "snapshot" ? 'timestamp' THEN ("snapshot" - 'timestamp') || jsonb_build_object('sent_at', "snapshot" -> 'timestamp') ELSE "snapshot" END,
                "created_at", "resolved_by", "resolved_at", "violation_id"
            FROM "user_reports"
            ON CONFLICT ("id") DO NOTHING`,
        );
        await queryRunner.query(`DROP TABLE "user_reports"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reports" DROP COLUMN IF EXISTS "violation_id"`);
    }
}
