/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

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

export class SavedAndScheduledMessages1791318264733 implements MigrationInterface {
    name = "SavedAndScheduledMessages1791318264733";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "saved_messages" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "message_id" bigint NOT NULL, "saved_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "due_at" TIMESTAMP WITH TIME ZONE, "notes" character varying, CONSTRAINT "PK_saved_messages_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_saved_message_user_message" UNIQUE ("user_id", "message_id"), CONSTRAINT "FK_saved_message_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "FK_saved_message_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE, CONSTRAINT "FK_saved_message_message_id" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_saved_message_user_id" ON "saved_messages" ("user_id")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "scheduled_messages" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "send_at" TIMESTAMP WITH TIME ZONE NOT NULL, "payload" jsonb NOT NULL, "state" smallint NOT NULL DEFAULT 0, CONSTRAINT "PK_scheduled_messages_id" PRIMARY KEY ("id"), CONSTRAINT "FK_scheduled_message_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "FK_scheduled_message_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_scheduled_message_user_id" ON "scheduled_messages" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_scheduled_message_due" ON "scheduled_messages" ("state", "send_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_messages"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "saved_messages"`);
    }
}
