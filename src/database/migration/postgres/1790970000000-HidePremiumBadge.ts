import { MigrationInterface, QueryRunner } from "typeorm";

export class HidePremiumBadge1790970000000 implements MigrationInterface {
    name = "HidePremiumBadge1790970000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "hide_premium_badge" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "hide_premium_badge"`);
    }
}
