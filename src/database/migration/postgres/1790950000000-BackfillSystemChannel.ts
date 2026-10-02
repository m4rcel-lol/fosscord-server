import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillSystemChannel1790950000000 implements MigrationInterface {
    name = "BackfillSystemChannel1790950000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "guilds" g SET "system_channel_id" = (SELECT c."id" FROM "channels" c WHERE c."guild_id" = g."id" AND c."type" = 0 ORDER BY array_position(g."channel_ordering", c."id"::int8) NULLS LAST, c."id" LIMIT 1) WHERE g."system_channel_id" IS NULL`,
        );
    }

    public async down(): Promise<void> {}
}
