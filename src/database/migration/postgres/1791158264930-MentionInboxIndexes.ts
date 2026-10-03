import { MigrationInterface, QueryRunner } from "typeorm";

export class MentionInboxIndexes1791158264930 implements MigrationInterface {
    name = "MentionInboxIndexes1791158264930";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_mention_everyone" ON "messages" ("id") WHERE "mention_everyone"`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_message_user_mentions_user_message" ON "message_user_mentions" ("user_id", "message_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_message_role_mentions_role_message" ON "message_role_mentions" ("role_id", "message_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_role_mentions_role_message"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_user_mentions_user_message"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_mention_everyone"`);
    }
}
