import { MigrationInterface, QueryRunner } from "typeorm";

export class EmbeddedActivities1791248573061 implements MigrationInterface {
    name = "EmbeddedActivities1791248573061";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "embedded_activities" ("application_id" bigint NOT NULL, "builtin" character varying, "url_mappings" jsonb NOT NULL DEFAULT '[]', "config" jsonb NOT NULL DEFAULT '{}', "assets" jsonb NOT NULL DEFAULT '[]', "shelf_rank" integer NOT NULL DEFAULT '0', "on_shelf" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_ce7d7eadc20540d25d10fe0deab" UNIQUE ("builtin"), CONSTRAINT "PK_80925e985a3d0e0cd6234e075c5" PRIMARY KEY ("application_id"), CONSTRAINT "FK_embedded_activity_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "activity_instances" ("id" bigint NOT NULL, "application_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "guild_id" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_activity_instance_application_channel" UNIQUE ("application_id", "channel_id"), CONSTRAINT "PK_75798a88b900a6a5549c9895336" PRIMARY KEY ("id"), CONSTRAINT "FK_activity_instance_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_activity_instance_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_activity_instances_channel_id" ON "activity_instances" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_activity_instances_guild_id" ON "activity_instances" ("guild_id")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "activity_instance_participants" ("instance_id" bigint NOT NULL, "user_id" bigint NOT NULL, "session_id" character varying NOT NULL, "nonce" character varying, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b55d5c6f317c092f7d1754ea665" PRIMARY KEY ("instance_id", "user_id"), CONSTRAINT "FK_activity_instance_participant_instance_id" FOREIGN KEY ("instance_id") REFERENCES "activity_instances"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_activity_instance_participant_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_activity_instance_participants_user_id" ON "activity_instance_participants" ("user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "activity_instance_participants"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "activity_instances"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "embedded_activities"`);
    }
}
