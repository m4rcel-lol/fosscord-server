import { MigrationInterface, QueryRunner } from "typeorm";

export class AccountPreferences1791048273615 implements MigrationInterface {
    name = "AccountPreferences1791048273615";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "account_preferences" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "account_preferences"`);
    }
}
