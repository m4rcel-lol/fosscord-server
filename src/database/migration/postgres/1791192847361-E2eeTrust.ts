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

export class E2eeTrust1791192847361 implements MigrationInterface {
    name = "E2eeTrust1791192847361";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" ADD COLUMN IF NOT EXISTS "trust" character varying`);
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" ADD COLUMN IF NOT EXISTS "trust_version" integer NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" DROP COLUMN IF EXISTS "trust_version"`);
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" DROP COLUMN IF EXISTS "trust"`);
    }
}
