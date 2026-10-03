import { MigrationInterface, QueryRunner } from "typeorm";

export class PersistentRateLimits1791176305817 implements MigrationInterface {
    name = "PersistentRateLimits1791176305817";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`TRUNCATE "rate_limits"`);
        await queryRunner.query(`ALTER TABLE "rate_limits" ALTER COLUMN "id" TYPE character varying`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_rate_limits_expires_at" ON "rate_limits" ("expires_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rate_limits_expires_at"`);
        await queryRunner.query(`TRUNCATE "rate_limits"`);
        await queryRunner.query(`ALTER TABLE "rate_limits" ALTER COLUMN "id" TYPE int8 USING "id"::int8`);
    }
}
