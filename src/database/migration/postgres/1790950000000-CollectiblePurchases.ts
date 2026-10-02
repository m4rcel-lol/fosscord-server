import { MigrationInterface, QueryRunner } from "typeorm";

export class CollectiblePurchases1790950000000 implements MigrationInterface {
    name = "CollectiblePurchases1790950000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "collectible_purchases" ("user_id" bigint NOT NULL, "sku_id" bigint NOT NULL, "purchased_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_collectible_purchases" PRIMARY KEY ("user_id", "sku_id"))`,
        );
        await queryRunner.query(
            `ALTER TABLE "collectible_purchases" ADD CONSTRAINT "FK_collectible_purchase_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "collectible_purchases" DROP CONSTRAINT "FK_collectible_purchase_user_id"`);
        await queryRunner.query(`DROP TABLE "collectible_purchases"`);
    }
}
