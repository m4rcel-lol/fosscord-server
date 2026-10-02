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

export class Expressions1790934299965 implements MigrationInterface {
    name = "Expressions1790934299965";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "soundboard_sounds" ("id" bigint NOT NULL, "guild_id" bigint NOT NULL, "name" character varying NOT NULL, "volume" double precision NOT NULL DEFAULT '1', "emoji_id" bigint, "emoji_name" character varying, "user_id" bigint, "available" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d1671b1f7e64535410e412f31ba" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_124558309acd065c3cf083b848" ON "soundboard_sounds"  ("guild_id") `);
        await queryRunner.query(`ALTER TABLE "stickers" ADD "sort_value" integer`);
        await queryRunner.query(`ALTER TABLE "sticker_packs" ADD "sku_id" bigint`);
        await queryRunner.query(
            `ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "FK_soundboard_sound_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "FK_soundboard_sound_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "soundboard_sounds" DROP CONSTRAINT "FK_soundboard_sound_user_id"`);
        await queryRunner.query(`ALTER TABLE "soundboard_sounds" DROP CONSTRAINT "FK_soundboard_sound_guild_id"`);
        await queryRunner.query(`ALTER TABLE "sticker_packs" DROP COLUMN "sku_id"`);
        await queryRunner.query(`ALTER TABLE "stickers" DROP COLUMN "sort_value"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_124558309acd065c3cf083b848"`);
        await queryRunner.query(`DROP TABLE "soundboard_sounds"`);
    }
}
