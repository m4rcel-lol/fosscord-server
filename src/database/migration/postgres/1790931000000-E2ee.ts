import { MigrationInterface, QueryRunner } from "typeorm";

export class E2ee1790931000000 implements MigrationInterface {
    name = "E2ee1790931000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "e2ee_identities" ("user_id" bigint NOT NULL, "public_key" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e2ee_identities_user_id" PRIMARY KEY ("user_id"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "e2ee_devices" ("id" character varying NOT NULL, "user_id" bigint NOT NULL, "signing_key" character varying NOT NULL, "identity_signature" character varying, "status" character varying NOT NULL, "name" character varying, "prekey_id" integer NOT NULL, "prekey_public" character varying NOT NULL, "prekey_signature" character varying NOT NULL, "prekey_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e2ee_devices_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_e2ee_device_user_id" ON "e2ee_devices" ("user_id") `);
        await queryRunner.query(
            `ALTER TABLE "e2ee_identities" ADD CONSTRAINT "FK_e2ee_identity_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "e2ee_devices" ADD CONSTRAINT "FK_e2ee_device_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(`ALTER TABLE "channels" ADD "e2ee_enabled_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "encrypted" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "encrypted"`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "e2ee_enabled_at"`);
        await queryRunner.query(`ALTER TABLE "e2ee_devices" DROP CONSTRAINT "FK_e2ee_device_user_id"`);
        await queryRunner.query(`ALTER TABLE "e2ee_identities" DROP CONSTRAINT "FK_e2ee_identity_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2ee_device_user_id"`);
        await queryRunner.query(`DROP TABLE "e2ee_devices"`);
        await queryRunner.query(`DROP TABLE "e2ee_identities"`);
    }
}
