import { MigrationInterface, QueryRunner } from "typeorm";

export class FixDmStates1791043817265 implements MigrationInterface {
    name = "FixDmStates1791043817265";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "messages" SET "type" = 0, "message_reference" = NULL, "message_reference_id" = NULL WHERE "type" = 19 AND "message_reference" IS NOT NULL AND ("message_reference"->>'message_id') IS NULL`,
        );
        await queryRunner.query(
            `UPDATE "recipients" r SET "message_request_timestamp" = NULL WHERE r."message_request_timestamp" IS NOT NULL AND EXISTS (SELECT 1 FROM "messages" m WHERE m."channel_id" = r."channel_id" AND m."author_id" = r."user_id")`,
        );
    }

    public async down(): Promise<void> {}
}
