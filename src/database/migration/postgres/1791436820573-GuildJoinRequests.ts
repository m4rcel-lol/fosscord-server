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

export class GuildJoinRequests1791436820573 implements MigrationInterface {
    name = "GuildJoinRequests1791436820573";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "guild_join_requests" ("id" bigint NOT NULL, "guild_id" bigint NOT NULL, "user_id" bigint NOT NULL, "application_status" character varying NOT NULL DEFAULT 'STARTED', "form_responses" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actioned_at" TIMESTAMP WITH TIME ZONE, "actioned_by_id" bigint, "rejection_reason" text, "last_seen" TIMESTAMP WITH TIME ZONE, "interview_channel_id" bigint, CONSTRAINT "PK_guild_join_requests_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_guild_join_requests_guild_user" ON "guild_join_requests" ("guild_id", "user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guild_join_requests_guild_status" ON "guild_join_requests" ("guild_id", "application_status")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guild_join_requests_user_id" ON "guild_join_requests" ("user_id")`);
        for (const [name, column, table, onDelete] of [
            ["FK_guild_join_requests_guild_id", "guild_id", "guilds", "CASCADE"],
            ["FK_guild_join_requests_user_id", "user_id", "users", "CASCADE"],
            ["FK_guild_join_requests_actioned_by_id", "actioned_by_id", "users", "SET NULL"],
        ]) {
            const [{ exists }] = await queryRunner.query(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS "exists"`, [name]);
            if (exists) continue;
            await queryRunner.query(
                `ALTER TABLE "guild_join_requests" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${table}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "guild_join_requests"`);
    }
}
