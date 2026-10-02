import { MigrationInterface, QueryRunner } from "typeorm";

export class RecipientMessageRequests1790940000000 implements MigrationInterface {
    name = "RecipientMessageRequests1790940000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recipients" ADD "message_request_timestamp" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recipients" DROP COLUMN "message_request_timestamp"`);
    }
}
