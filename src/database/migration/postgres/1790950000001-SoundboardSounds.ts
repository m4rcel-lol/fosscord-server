import { MigrationInterface, QueryRunner } from "typeorm";

export class SoundboardSounds1790950000001 implements MigrationInterface {
    name = "SoundboardSounds1790950000001";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "soundboard_sounds" ("id" bigint NOT NULL, "name" character varying NOT NULL, "volume" double precision NOT NULL DEFAULT '1', "emoji_id" character varying, "emoji_name" character varying, "available" boolean NOT NULL DEFAULT true, "guild_id" bigint NOT NULL, "user_id" bigint, CONSTRAINT "PK_soundboard_sounds_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_soundboard_sounds_guild_id" ON "soundboard_sounds" ("guild_id")`);
        await queryRunner.query(
            `ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "FK_soundboard_sound_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "FK_soundboard_sound_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "soundboard_sounds"`);
    }
}
