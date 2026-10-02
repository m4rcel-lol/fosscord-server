import { MigrationInterface, QueryRunner } from "typeorm";

export class ThreadsAndForums1790900000000 implements MigrationInterface {
    name = "ThreadsAndForums1790900000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "thread_members" ADD "user_id" bigint`);
        await queryRunner.query(`UPDATE "thread_members" SET "user_id" = "members"."id" FROM "members" WHERE "members"."index" = "thread_members"."member_idx"`);
        await queryRunner.query(`CREATE INDEX "IDX_thread_members_user_id" ON "thread_members" ("user_id")`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "default_reaction_emoji" jsonb`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "default_sort_order" integer`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "default_forum_layout" integer`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "default_tag_setting" character varying`);
        await queryRunner.query(`CREATE INDEX "IDX_channels_parent_id" ON "channels" ("parent_id")`);
        await queryRunner.query(`ALTER TABLE "channels" DROP CONSTRAINT "FK_channel_parent_id"`);
        await queryRunner.query(
            `ALTER TABLE "channels" ADD CONSTRAINT "FK_channel_parent_id" FOREIGN KEY ("parent_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_message_thread_id"`);
        await queryRunner.query(
            `ALTER TABLE "messages" ADD CONSTRAINT "FK_message_thread_id" FOREIGN KEY ("thread_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_message_thread_id"`);
        await queryRunner.query(
            `ALTER TABLE "messages" ADD CONSTRAINT "FK_message_thread_id" FOREIGN KEY ("thread_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(`ALTER TABLE "channels" DROP CONSTRAINT "FK_channel_parent_id"`);
        await queryRunner.query(
            `ALTER TABLE "channels" ADD CONSTRAINT "FK_channel_parent_id" FOREIGN KEY ("parent_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
        );
        await queryRunner.query(`DROP INDEX "IDX_channels_parent_id"`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "default_tag_setting"`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "default_forum_layout"`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "default_sort_order"`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "default_reaction_emoji"`);
        await queryRunner.query(`DROP INDEX "IDX_thread_members_user_id"`);
        await queryRunner.query(`ALTER TABLE "thread_members" DROP COLUMN "user_id"`);
    }
}
