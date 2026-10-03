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

// discord's own badge art, as offered by the admin panel's presets; the CDN proxies these icon hashes from discord's CDN.
// Staff takes the fixed id the staff badge sync looks for, and Subscriber is left out because profiles derive it from premium_type
const STAFF_BADGE = { id: "1", icon: "5e74e9b61934fc1f67c65515d1f7e60d", description: "Staff" };
const BADGES = [
    ["3f9748e53446a137a052f3454e2de41e", "Partnered Server Owner"],
    ["fee1624003e2fee35cb398e125dc479b", "Moderator Programs Alumni"],
    ["bf01d1073931f921909045f3a39fd264", "HypeSquad Events"],
    ["8a88d63823d8a71cd5e390baa45efa02", "HypeSquad Bravery"],
    ["011940fd013da3f7fb926e4a1cd2e618", "HypeSquad Brilliance"],
    ["3aa41de486fa12454c3761e8e223442e", "HypeSquad Balance"],
    ["2717692c7dca7289b35297368a940dd0", "Bug Hunter"],
    ["848f79194d4be5ff5f81505cbd0ce1e6", "Gold Bug Hunter"],
    ["6df5892e0f35b051f8b61eace34f4967", "Early Verified Bot Developer"],
    ["6bdc42827a38498929a4920da12695d9", "Active Developer"],
    ["7060786766c9c840eb3019e725d2b358", "Early Supporter"],
    ["7d9ae358c8c5e118768335dbe68b4fb8", "Completed a Quest"],
    ["83d8a1eb09a8d64e59233eec5d4d5c2d", "Orbs Apprentice"],
];

export class SeedDiscordBadges1791520000000 implements MigrationInterface {
    name = "SeedDiscordBadges1791520000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // instances that already made some of these by hand keep theirs
        const existing: { id: string; icon: string }[] = await queryRunner.query(`SELECT "id", "icon" FROM "badges"`);
        const taken = (icon: string) => existing.some((badge) => badge.icon === icon);

        if (!taken(STAFF_BADGE.icon) && !existing.some((badge) => badge.id === STAFF_BADGE.id))
            await queryRunner.query(`INSERT INTO "badges" ("id", "description", "icon") VALUES ($1, $2, $3)`, [STAFF_BADGE.id, STAFF_BADGE.description, STAFF_BADGE.icon]);

        for (const [position, [icon, description]] of BADGES.entries()) {
            if (taken(icon)) continue;
            await queryRunner.query(
                `INSERT INTO "badges" ("id", "description", "icon") VALUES ((((floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 1420070400000) << 22) + $1::bigint)::text, $2, $3)`,
                [position, description, icon],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const seeded: { id: string }[] = await queryRunner.query(
            `SELECT "id" FROM "badges" WHERE ("icon", "description") IN (SELECT * FROM unnest($1::varchar[], $2::varchar[]))`,
            [
                [STAFF_BADGE.icon, ...BADGES.map(([icon]) => icon)],
                [STAFF_BADGE.description, ...BADGES.map(([, description]) => description)],
            ],
        );
        for (const { id } of seeded) {
            await queryRunner.query(`UPDATE "users" SET "badge_ids" = array_remove("badge_ids", $1::int8) WHERE $1::int8 = ANY("badge_ids")`, [id]);
            await queryRunner.query(`DELETE FROM "badges" WHERE "id" = $1`, [id]);
        }
    }
}
