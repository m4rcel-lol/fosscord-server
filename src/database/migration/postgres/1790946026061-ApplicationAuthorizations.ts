import { MigrationInterface, QueryRunner } from "typeorm";

export class ApplicationAuthorizations1790946026061 implements MigrationInterface {
    name = "ApplicationAuthorizations1790946026061";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "application_authorizations" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "application_id" bigint NOT NULL, "scopes" jsonb NOT NULL DEFAULT '[]', "integration_type" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_application_authorization_user_application" UNIQUE ("user_id", "application_id"), CONSTRAINT "PK_24ba88a11bfb16e687439960b8b" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `ALTER TABLE "application_authorizations" ADD CONSTRAINT "FK_application_authorization_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "application_authorizations" ADD CONSTRAINT "FK_application_authorization_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "application_authorizations" DROP CONSTRAINT "FK_application_authorization_application_id"`);
        await queryRunner.query(`ALTER TABLE "application_authorizations" DROP CONSTRAINT "FK_application_authorization_user_id"`);
        await queryRunner.query(`DROP TABLE "application_authorizations"`);
    }
}
