import { MigrationInterface, QueryRunner } from "typeorm";

export class E2eeKeyBackup1790960000000 implements MigrationInterface {
    name = "E2eeKeyBackup1790960000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_identities" ADD "previous_key" character varying`);
        await queryRunner.query(`ALTER TABLE "e2ee_identities" ADD "rotation_signature" character varying`);
        await queryRunner.query(
            `CREATE TABLE "e2ee_key_backups" ("user_id" bigint NOT NULL, "version" integer NOT NULL, "mode" character varying NOT NULL, "kdf" jsonb NOT NULL, "salt" character varying NOT NULL, "wrapped_secret" character varying, "identity_key" character varying NOT NULL, "wrapped_identity" character varying NOT NULL, "backup_public_key" character varying NOT NULL, "backup_key_signature" character varying NOT NULL, "wrapped_backup_key" character varying NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e2ee_key_backups_user_id" PRIMARY KEY ("user_id"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "e2ee_backup_keys" ("user_id" bigint NOT NULL, "message_id" bigint NOT NULL, "enc" character varying NOT NULL, "wrapped" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e2ee_backup_keys_user_message" PRIMARY KEY ("user_id", "message_id"))`,
        );
        await queryRunner.query(
            `ALTER TABLE "e2ee_key_backups" ADD CONSTRAINT "FK_e2ee_key_backup_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "e2ee_backup_keys" ADD CONSTRAINT "FK_e2ee_backup_key_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_backup_keys" DROP CONSTRAINT "FK_e2ee_backup_key_user_id"`);
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" DROP CONSTRAINT "FK_e2ee_key_backup_user_id"`);
        await queryRunner.query(`DROP TABLE "e2ee_backup_keys"`);
        await queryRunner.query(`DROP TABLE "e2ee_key_backups"`);
        await queryRunner.query(`ALTER TABLE "e2ee_identities" DROP COLUMN "rotation_signature"`);
        await queryRunner.query(`ALTER TABLE "e2ee_identities" DROP COLUMN "previous_key"`);
    }
}
