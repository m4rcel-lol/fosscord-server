import { MigrationInterface, QueryRunner } from "typeorm";

export class UserGlobalNameProfileCollectibles1790933976000 implements MigrationInterface {
    name = "UserGlobalNameProfileCollectibles1790933976000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "global_name" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "profile_collectibles" jsonb`);
        await queryRunner.query(`ALTER TABLE "members" ADD "profile_collectibles" jsonb`);
        await queryRunner.query(`ALTER TABLE "users" ADD "recent_avatars" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "recent_avatars"`);
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN "profile_collectibles"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profile_collectibles"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "global_name"`);
    }
}
