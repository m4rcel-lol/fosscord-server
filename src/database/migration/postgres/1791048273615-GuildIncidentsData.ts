import { MigrationInterface, QueryRunner } from "typeorm";

export class GuildIncidentsData1791048273615 implements MigrationInterface {
    name = "GuildIncidentsData1791048273615";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD "incidents_data" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "incidents_data"`);
    }
}
