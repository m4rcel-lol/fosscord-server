import { MigrationInterface, QueryRunner } from "typeorm";

export class AppealsAndAnnouncements1791060000001 implements MigrationInterface {
    name = "AppealsAndAnnouncements1791060000001";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_violations" ADD "appeal_signal" integer`);
        await queryRunner.query(`ALTER TABLE "user_violations" ADD "appeal_user_input" text`);
        await queryRunner.query(`ALTER TABLE "user_violations" ADD "appeal_review_messages" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "user_violations" ADD "appeal_resolved_by" bigint`);
        await queryRunner.query(
            `CREATE TABLE "announcements" ("id" bigint NOT NULL, "title" character varying NOT NULL, "body" text NOT NULL, "audience" character varying NOT NULL, "sent_by" bigint, "recipient_count" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b3ad760876ff2e19d58e05dc8b0" PRIMARY KEY ("id"))`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "announcements"`);
        await queryRunner.query(`ALTER TABLE "user_violations" DROP COLUMN "appeal_resolved_by"`);
        await queryRunner.query(`ALTER TABLE "user_violations" DROP COLUMN "appeal_review_messages"`);
        await queryRunner.query(`ALTER TABLE "user_violations" DROP COLUMN "appeal_user_input"`);
        await queryRunner.query(`ALTER TABLE "user_violations" DROP COLUMN "appeal_signal"`);
    }
}
