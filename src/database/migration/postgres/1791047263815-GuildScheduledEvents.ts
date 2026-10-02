import { MigrationInterface, QueryRunner } from "typeorm";

export class GuildScheduledEvents1791047263815 implements MigrationInterface {
    name = "GuildScheduledEvents1791047263815";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "guild_scheduled_events" ("id" bigint NOT NULL, "guild_id" bigint NOT NULL, "channel_id" bigint, "creator_id" bigint, "name" character varying NOT NULL, "description" text, "scheduled_start_time" TIMESTAMP WITH TIME ZONE NOT NULL, "scheduled_end_time" TIMESTAMP WITH TIME ZONE, "privacy_level" integer NOT NULL DEFAULT 2, "status" integer NOT NULL DEFAULT 1, "entity_type" integer NOT NULL, "entity_id" bigint, "entity_metadata" jsonb, "image" character varying, "recurrence_rule" jsonb, "exceptions" jsonb NOT NULL DEFAULT '[]', "auto_start" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_guild_scheduled_events_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_guild_scheduled_events_guild_id" ON "guild_scheduled_events" ("guild_id")`);
        await queryRunner.query(
            `ALTER TABLE "guild_scheduled_events" ADD CONSTRAINT "FK_guild_scheduled_event_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "guild_scheduled_events" ADD CONSTRAINT "FK_guild_scheduled_event_creator_id" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `CREATE TABLE "guild_scheduled_event_users" ("id" bigint NOT NULL, "guild_scheduled_event_id" bigint NOT NULL, "user_id" bigint NOT NULL, "guild_id" bigint NOT NULL, "guild_scheduled_event_exception_id" bigint, "response" integer NOT NULL DEFAULT 1, CONSTRAINT "PK_guild_scheduled_event_users_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_guild_scheduled_event_users_event_user" ON "guild_scheduled_event_users" ("guild_scheduled_event_id", "user_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_guild_scheduled_event_users_user_id" ON "guild_scheduled_event_users" ("user_id")`);
        await queryRunner.query(
            `ALTER TABLE "guild_scheduled_event_users" ADD CONSTRAINT "FK_guild_scheduled_event_user_event_id" FOREIGN KEY ("guild_scheduled_event_id") REFERENCES "guild_scheduled_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "guild_scheduled_event_users" ADD CONSTRAINT "FK_guild_scheduled_event_user_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "guild_scheduled_event_users"`);
        await queryRunner.query(`DROP TABLE "guild_scheduled_events"`);
    }
}
