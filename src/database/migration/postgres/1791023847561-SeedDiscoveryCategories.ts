import { MigrationInterface, QueryRunner } from "typeorm";

const categories: [number, string, boolean][] = [
    [0, "General", false],
    [1, "Gaming", true],
    [2, "Music", true],
    [3, "Entertainment", true],
    [4, "Creative Arts", true],
    [5, "Science & Tech", true],
    [6, "Education", true],
    [7, "Sports", true],
    [8, "Fashion & Beauty", true],
    [9, "Relationships & Identity", true],
    [10, "Travel & Food", true],
    [11, "Fitness & Health", true],
    [12, "Finance", true],
    [13, "Other", true],
    [14, "General Chatting", true],
    [15, "Esports", false],
    [16, "Anime & Manga", false],
    [17, "Movies & TV", false],
    [18, "Books", false],
    [19, "Art", false],
    [20, "Writing", false],
    [21, "Crafts, DIY, & Making", false],
    [22, "Programming", false],
    [23, "Podcasts", false],
    [24, "Tabletop Games", false],
    [25, "Memes", false],
    [26, "News & Current Events", false],
    [27, "Cryptocurrency", false],
    [28, "Investing", false],
    [29, "Studying & Homework", false],
    [30, "LFG", false],
    [31, "Customer Support", false],
    [32, "Theorycraft", false],
    [33, "Events", false],
    [34, "Roleplay", false],
    [35, "Content Creator", false],
    [36, "Business", false],
    [37, "Local Group", false],
    [38, "Collaboration", false],
    [39, "Fandom", false],
    [40, "Wiki & Guide", false],
    [42, "Subreddit", false],
    [43, "Emoji", false],
    [44, "Comics & Cartoons", false],
    [45, "Mobile", false],
    [46, "Console", false],
    [47, "Charity & Nonprofit", false],
];

export class SeedDiscoveryCategories1791023847561 implements MigrationInterface {
    name = "SeedDiscoveryCategories1791023847561";

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const [id, name, primary] of categories)
            await queryRunner.query(`INSERT INTO "categories" ("id", "name", "localizations", "is_primary") VALUES ($1, $2, '{}', $3) ON CONFLICT ("id") DO NOTHING`, [
                id,
                name,
                primary,
            ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "categories" WHERE "id" = ANY($1)`, [categories.map(([id]) => id)]);
    }
}
