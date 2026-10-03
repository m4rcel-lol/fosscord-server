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

export class ModerationSafety1791362847193 implements MigrationInterface {
    name = "ModerationSafety1791362847193";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "safety_alerts_channel_id" bigint`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_automod_rules_guild_id" ON "automod_rules" ("guild_id")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "user_reports" ("id" bigint NOT NULL, "type" character varying NOT NULL, "reporter_id" bigint, "reported_user_id" bigint, "guild_id" bigint, "channel_id" bigint, "message_id" bigint, "breadcrumbs" jsonb NOT NULL DEFAULT '[]', "elements" jsonb NOT NULL DEFAULT '{}', "snapshot" jsonb, "status" integer NOT NULL DEFAULT 0, "resolved_by" bigint, "resolved_at" TIMESTAMP WITH TIME ZONE, "violation_id" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_reports_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_reports_status" ON "user_reports" ("status", "id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_reports_reported_user_id" ON "user_reports" ("reported_user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_reports_reporter_id" ON "user_reports" ("reporter_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "user_reports"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automod_rules_guild_id"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "safety_alerts_channel_id"`);
    }
}
