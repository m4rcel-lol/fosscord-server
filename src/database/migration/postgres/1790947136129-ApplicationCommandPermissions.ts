import { MigrationInterface, QueryRunner } from "typeorm";

export class ApplicationCommandPermissions1790947136129 implements MigrationInterface {
    name = "ApplicationCommandPermissions1790947136129";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "application_command_permissions" ("id" bigint NOT NULL, "guild_id" bigint NOT NULL, "application_id" bigint NOT NULL, "permissions" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_e9690ac341bba103517a5f4362e" PRIMARY KEY ("id", "guild_id"))`,
        );
        await queryRunner.query(
            `ALTER TABLE "application_command_permissions" ADD CONSTRAINT "FK_application_command_permission_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "application_command_permissions" ADD CONSTRAINT "FK_application_command_permission_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "application_command_permissions" DROP CONSTRAINT "FK_application_command_permission_application_id"`);
        await queryRunner.query(`ALTER TABLE "application_command_permissions" DROP CONSTRAINT "FK_application_command_permission_guild_id"`);
        await queryRunner.query(`DROP TABLE "application_command_permissions"`);
    }
}
