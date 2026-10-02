import { MigrationInterface, QueryRunner } from "typeorm";

export class KeepWebhookMessages1790950100000 implements MigrationInterface {
    name = "KeepWebhookMessages1790950100000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_message_webhook_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "messages" WHERE "webhook_id" IS NOT NULL AND "webhook_id" NOT IN (SELECT "id" FROM "webhooks")`);
        await queryRunner.query(
            `ALTER TABLE "messages" ADD CONSTRAINT "FK_message_webhook_id" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
        );
    }
}
