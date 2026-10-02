import { MigrationInterface, QueryRunner } from "typeorm";

export class EveryoneVoicePermissions1791163470829 implements MigrationInterface {
    name = "EveryoneVoicePermissions1791163470829";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "roles" SET "permissions" = ("permissions"::bigint | 2248471214030848)::text WHERE "id" = "guild_id" AND (CASE WHEN "permissions" ~ '^[0-9]{1,18}$' THEN ("permissions"::bigint & 140737488355328) = 0 ELSE false END)`,
        );
    }

    public async down(): Promise<void> {}
}
