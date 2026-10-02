import { MigrationInterface, QueryRunner } from "typeorm";

export class AccountStanding1791060000000 implements MigrationInterface {
    name = "AccountStanding1791060000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "account_standing" integer`);
        await queryRunner.query(
            `CREATE TABLE "user_violations" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "classification_type" integer NOT NULL, "description" text NOT NULL, "actions" jsonb NOT NULL DEFAULT '[]', "flagged_content" jsonb NOT NULL DEFAULT '[]', "issued_by" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "appeal_status" integer, "appealed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ed9b1603cd63021fc872c370dd9" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_user_violation_user_id" ON "user_violations" ("user_id")`);
        await queryRunner.query(
            `ALTER TABLE "user_violations" ADD CONSTRAINT "FK_185c908a50a51e776f3ec3a2267" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_violations" DROP CONSTRAINT "FK_185c908a50a51e776f3ec3a2267"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_user_violation_user_id"`);
        await queryRunner.query(`DROP TABLE "user_violations"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "account_standing"`);
    }
}
