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

export class OAuth2Tokens1791204738512 implements MigrationInterface {
    name = "OAuth2Tokens1791204738512";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "client_secret_hash" character varying`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "oauth2_tokens" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "application_id" bigint NOT NULL, "authorization_id" bigint, "scopes" jsonb NOT NULL DEFAULT '[]', "access_token_hash" character varying NOT NULL, "refresh_token_hash" character varying, "code_hash" character varying, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_oauth2_tokens_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_oauth2_token_user_application" ON "oauth2_tokens" ("user_id", "application_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oauth2_token_access_token_hash" ON "oauth2_tokens" ("access_token_hash")`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oauth2_token_refresh_token_hash" ON "oauth2_tokens" ("refresh_token_hash")`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oauth2_token_code_hash" ON "oauth2_tokens" ("code_hash")`);
        await queryRunner.query(`ALTER TABLE "oauth2_tokens" DROP CONSTRAINT IF EXISTS "FK_oauth2_token_user_id"`);
        await queryRunner.query(`ALTER TABLE "oauth2_tokens" DROP CONSTRAINT IF EXISTS "FK_oauth2_token_application_id"`);
        await queryRunner.query(`ALTER TABLE "oauth2_tokens" DROP CONSTRAINT IF EXISTS "FK_oauth2_token_authorization_id"`);
        await queryRunner.query(
            `ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "FK_oauth2_token_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "FK_oauth2_token_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "FK_oauth2_token_authorization_id" FOREIGN KEY ("authorization_id") REFERENCES "application_authorizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "oauth2_tokens"`);
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "client_secret_hash"`);
    }
}
