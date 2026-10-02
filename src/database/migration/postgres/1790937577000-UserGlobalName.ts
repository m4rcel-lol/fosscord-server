import { MigrationInterface, QueryRunner } from "typeorm";

export class UserGlobalName1790937577000 implements MigrationInterface {
    name = "UserGlobalName1790937577000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "global_name" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "global_name"`);
    }
}
