import { MigrationInterface, QueryRunner } from "typeorm";

export class ApplicationInteractionKeys1790950000000 implements MigrationInterface {
    name = "ApplicationInteractionKeys1790950000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" ADD "interactions_private_key" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "interactions_private_key"`);
    }
}
