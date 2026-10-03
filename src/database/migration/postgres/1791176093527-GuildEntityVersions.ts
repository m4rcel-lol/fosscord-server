/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { MigrationInterface, QueryRunner } from "typeorm";

const now = `(extract(epoch from clock_timestamp()) * 1000)::bigint`;
const versioned: [table: string, type: number][] = [
    ["channels", 0],
    ["roles", 1],
    ["emojis", 2],
    ["stickers", 3],
];

export class GuildEntityVersions1791176093527 implements MigrationInterface {
    name = "GuildEntityVersions1791176093527";

    public async up(queryRunner: QueryRunner): Promise<void> {
        const initial = Date.now();
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "guild_entity_deletes" ("guild_id" bigint NOT NULL, "entity_type" smallint NOT NULL, "entity_id" bigint NOT NULL, "version" bigint NOT NULL)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guild_entity_deletes_guild_version" ON "guild_entity_deletes" ("guild_id", "version")`);
        await queryRunner.query(`CREATE OR REPLACE FUNCTION "bump_entity_version"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."version" := ${now}; RETURN NEW; END $$`);
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "record_entity_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD."guild_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "guilds" WHERE "id" = OLD."guild_id") THEN
                    INSERT INTO "guild_entity_deletes" ("guild_id", "entity_type", "entity_id", "version") VALUES (OLD."guild_id", TG_ARGV[0]::smallint, OLD."id", ${now});
                END IF;
                RETURN OLD;
            END $$`,
        );
        for (const [table, type] of versioned) {
            await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "version" bigint NOT NULL DEFAULT ${initial}`);
            await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_${table}_version" ON "${table}"`);
            await queryRunner.query(`CREATE TRIGGER "TRG_${table}_version" BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "bump_entity_version"()`);
            await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_${table}_record_delete" ON "${table}"`);
            await queryRunner.query(
                `CREATE TRIGGER "TRG_${table}_record_delete" AFTER DELETE ON "${table}" FOR EACH ROW ${table === "channels" ? `WHEN (OLD."type" NOT IN (10, 11, 12)) ` : ""}EXECUTE FUNCTION "record_entity_delete"('${type}')`,
            );
        }

        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "channels_version" bigint NOT NULL DEFAULT ${initial}`);
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "bump_guild_channels_version"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' OR NEW."channel_ordering" IS DISTINCT FROM OLD."channel_ordering" THEN NEW."channels_version" := ${now}; END IF;
                RETURN NEW;
            END $$`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_guilds_channels_version" ON "guilds"`);
        await queryRunner.query(
            `CREATE TRIGGER "TRG_guilds_channels_version" BEFORE INSERT OR UPDATE OF "channel_ordering" ON "guilds" FOR EACH ROW EXECUTE FUNCTION "bump_guild_channels_version"()`,
        );

        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "bump_tag_channel_version"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                UPDATE "channels" SET "version" = 0 WHERE "id" = COALESCE(NEW."channel_id", OLD."channel_id");
                RETURN NULL;
            END $$`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_tags_channel_version" ON "tags"`);
        await queryRunner.query(`CREATE TRIGGER "TRG_tags_channel_version" AFTER INSERT OR UPDATE OR DELETE ON "tags" FOR EACH ROW EXECUTE FUNCTION "bump_tag_channel_version"()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_tags_channel_version" ON "tags"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "bump_tag_channel_version"()`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_guilds_channels_version" ON "guilds"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "bump_guild_channels_version"()`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "channels_version"`);
        for (const [table] of versioned) {
            await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_${table}_record_delete" ON "${table}"`);
            await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_${table}_version" ON "${table}"`);
            await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "version"`);
        }
        await queryRunner.query(`DROP FUNCTION IF EXISTS "record_entity_delete"()`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "bump_entity_version"()`);
        await queryRunner.query(`DROP TABLE IF EXISTS "guild_entity_deletes"`);
    }
}
