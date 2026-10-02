import { MigrationInterface, QueryRunner } from "typeorm";

export class E2eeDeviceSession1791106482917 implements MigrationInterface {
    name = "E2eeDeviceSession1791106482917";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_devices" ADD COLUMN IF NOT EXISTS "session_id" character varying`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_e2ee_device_session_id" ON "e2ee_devices" ("session_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_e2ee_device_session_id"`);
        await queryRunner.query(`ALTER TABLE "e2ee_devices" DROP COLUMN IF EXISTS "session_id"`);
    }
}
