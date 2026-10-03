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

export class Notifications1791348215673 implements MigrationInterface {
    name = "Notifications1791348215673";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "private_channel_settings" jsonb`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "push_devices" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "session_id" character varying, "provider" character varying NOT NULL, "token" text NOT NULL, "keys" jsonb, "voip_provider" character varying, "voip_token" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_push_devices_id" PRIMARY KEY ("id"), CONSTRAINT "FK_push_device_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_push_device_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions"("session_id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_push_devices_provider_token" ON "push_devices" ("provider", "token")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_push_devices_user_id" ON "push_devices" ("user_id")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "mention_dismissals" ("user_id" bigint NOT NULL, "message_id" bigint NOT NULL, CONSTRAINT "PK_mention_dismissals" PRIMARY KEY ("user_id", "message_id"), CONSTRAINT "FK_mention_dismissal_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_mention_dismissal_message_id" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(
            `UPDATE "members" m SET "settings" = jsonb_set(m."settings", '{message_notifications}', '3') FROM "guilds" g WHERE g."id" = m."guild_id" AND COALESCE((m."settings"->>'version')::int, 0) = 0 AND (m."settings"->>'message_notifications')::int = g."default_message_notifications"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "mention_dismissals"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "push_devices"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "private_channel_settings"`);
    }
}
