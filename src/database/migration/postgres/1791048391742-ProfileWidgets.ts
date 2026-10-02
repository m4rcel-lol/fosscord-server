import { MigrationInterface, QueryRunner } from "typeorm";

export class ProfileWidgets1791048391742 implements MigrationInterface {
    name = "ProfileWidgets1791048391742";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "profile_widgets" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profile_widgets"`);
    }
}
