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

export class AnnouncementMessages1791540000000 implements MigrationInterface {
    name = "AnnouncementMessages1791540000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "announcement_messages" ("message_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "announcement_id" bigint NOT NULL, CONSTRAINT "PK_announcement_messages" PRIMARY KEY ("message_id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_announcement_messages_announcement_id" ON "announcement_messages" ("announcement_id")`);
        await queryRunner.query(
            `ALTER TABLE "announcement_messages" ADD CONSTRAINT "FK_announcement_messages_message_id" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "announcement_messages" ADD CONSTRAINT "FK_announcement_messages_announcement_id" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "announcement_messages"`);
    }
}
