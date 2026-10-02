import { MigrationInterface, QueryRunner } from "typeorm";

export class GuildManagement1790938585486 implements MigrationInterface {
    name = "GuildManagement1790938585486";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD "vanity_url_code" character varying`);
        await queryRunner.query(`ALTER TABLE "guilds" ADD "profile" jsonb`);
        await queryRunner.query(`ALTER TABLE "guilds" ADD "home_settings" jsonb`);
        await queryRunner.query(`ALTER TABLE "guilds" ADD "onboarding" jsonb`);
        await queryRunner.query(`ALTER TABLE "guilds" ADD "member_verification" jsonb`);
        await queryRunner.query(`ALTER TABLE "guilds" ADD "discovery_metadata" jsonb`);
        await queryRunner.query(`ALTER TABLE "members" ADD "source_invite_code" character varying`);
        await queryRunner.query(`ALTER TABLE "members" ADD "join_source_type" integer`);
        await queryRunner.query(`ALTER TABLE "members" ADD "inviter_id" bigint`);
        await queryRunner.query(`ALTER TABLE "members" ADD "onboarding_responses" jsonb`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "FK_audit_log_guild_id"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "FK_audit_log_target_user_id"`);
        await queryRunner.query(
            `UPDATE "guilds" g SET "vanity_url_code" = i."code" FROM "invites" i WHERE i."guild_id" = g."id" AND i."vanity_url" = true AND g."vanity_url_code" IS NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN "onboarding_responses"`);
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN "inviter_id"`);
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN "join_source_type"`);
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN "source_invite_code"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "discovery_metadata"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "member_verification"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "onboarding"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "home_settings"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "profile"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "vanity_url_code"`);
    }
}
