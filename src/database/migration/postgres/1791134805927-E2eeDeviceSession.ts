import { MigrationInterface, QueryRunner } from "typeorm";

export class E2eeDeviceSession1791134805927 implements MigrationInterface {
    name = "E2eeDeviceSession1791134805927";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_devices" ADD COLUMN IF NOT EXISTS "session_id" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_devices" DROP COLUMN IF EXISTS "session_id"`);
    }
}
