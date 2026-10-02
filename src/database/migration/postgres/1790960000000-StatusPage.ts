import { MigrationInterface, QueryRunner } from "typeorm";

export class StatusPage1790960000000 implements MigrationInterface {
    name = "StatusPage1790960000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "status_components" ("id" bigint NOT NULL, "name" character varying NOT NULL, "description" text, "status" character varying NOT NULL DEFAULT 'operational', "position" integer NOT NULL DEFAULT 0, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2857c13698b9a79f3be73045cd5" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "status_incidents" ("id" bigint NOT NULL, "name" character varying NOT NULL, "impact" character varying NOT NULL DEFAULT 'none', "status" character varying NOT NULL DEFAULT 'investigating', "updates" jsonb NOT NULL DEFAULT '[]', "component_ids" bigint array NOT NULL DEFAULT '{}', "scheduled_for" TIMESTAMP WITH TIME ZONE, "scheduled_until" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolved_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b7e07f5c847021e3040f59f85aa" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_status_incident_status" ON "status_incidents" ("status")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_status_incident_status"`);
        await queryRunner.query(`DROP TABLE "status_incidents"`);
        await queryRunner.query(`DROP TABLE "status_components"`);
    }
}
