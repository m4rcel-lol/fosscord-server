import { MigrationInterface, QueryRunner } from "typeorm";

export class VoiceConnectedAtAndCalls1790950000000 implements MigrationInterface {
    name = "VoiceConnectedAtAndCalls1790950000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "voice_states" ADD "connected_at" bigint`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "call" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "call"`);
        await queryRunner.query(`ALTER TABLE "voice_states" DROP COLUMN "connected_at"`);
    }
}
