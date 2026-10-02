import { MigrationInterface, QueryRunner } from "typeorm";

export class ClearSelfMessageRequests1791058314207 implements MigrationInterface {
    name = "ClearSelfMessageRequests1791058314207";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "recipients" r SET "message_request_timestamp" = NULL WHERE r."message_request_timestamp" IS NOT NULL AND EXISTS (SELECT 1 FROM "messages" m WHERE m."channel_id" = r."channel_id" AND m."author_id" = r."user_id")`,
        );
    }

    public async down(): Promise<void> {}
}
