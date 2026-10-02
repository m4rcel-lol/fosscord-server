import { MigrationInterface, QueryRunner } from "typeorm";

export class SoundboardSounds1790950000001 implements MigrationInterface {
    name = "SoundboardSounds1790950000001";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable("soundboard_sounds")) return;
        await queryRunner.query(
            `CREATE TABLE "soundboard_sounds" ("id" bigint NOT NULL, "guild_id" bigint NOT NULL, "name" character varying NOT NULL, "volume" double precision NOT NULL DEFAULT '1', "emoji_id" bigint, "emoji_name" character varying, "user_id" bigint, "available" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d1671b1f7e64535410e412f31ba" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_124558309acd065c3cf083b848" ON "soundboard_sounds" ("guild_id")`);
        await queryRunner.query(
            `ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "FK_soundboard_sound_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "FK_soundboard_sound_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
    }

    public async down(): Promise<void> {}
}
