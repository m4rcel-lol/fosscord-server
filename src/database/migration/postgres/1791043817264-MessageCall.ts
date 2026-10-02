import { MigrationInterface, QueryRunner } from "typeorm";

export class MessageCall1791043817264 implements MigrationInterface {
    name = "MessageCall1791043817264";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD "call" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "call"`);
    }
}
