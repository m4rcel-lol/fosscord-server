import { MigrationInterface, QueryRunner } from "typeorm";

export class UserGlobalNameProfileEffect1790933976000 implements MigrationInterface {
    name = "UserGlobalNameProfileEffect1790933976000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "global_name" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "profile_effect" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profile_effect"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "global_name"`);
    }
}
