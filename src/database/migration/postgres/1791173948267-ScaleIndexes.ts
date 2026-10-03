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

const added: [string, string][] = [
    ["IDX_mention_dismissals_message_id", `"mention_dismissals" ("message_id")`],
    ["IDX_saved_messages_message_id", `"saved_messages" ("message_id")`],
    ["IDX_saved_messages_channel_id", `"saved_messages" ("channel_id")`],
    ["IDX_scheduled_messages_channel_id", `"scheduled_messages" ("channel_id")`],
    ["IDX_push_devices_session_id", `"push_devices" ("session_id")`],
    ["IDX_oauth2_tokens_application_id", `"oauth2_tokens" ("application_id")`],
    ["IDX_oauth2_tokens_authorization_id", `"oauth2_tokens" ("authorization_id")`],
    ["IDX_guild_join_requests_actioned_by_id", `"guild_join_requests" ("actioned_by_id")`],
    ["IDX_sticker_packs_cover_sticker_id", `"sticker_packs" ("coverStickerId")`],
    ["IDX_messages_channel_pinned_at", `"messages" ("channel_id", "pinned_at") WHERE "pinned_at" IS NOT NULL`],
    ["IDX_messages_open_calls", `"messages" ("id") WHERE "type" = 3 AND "call" IS NOT NULL AND ("call"->>'ended_timestamp') IS NULL`],
];

const redundant: [string, string][] = [
    ["IDX_86b9109b155eb70c0a2ca3b4b6", `"messages" ("channel_id")`],
    ["IDX_972e8e013af7698f8aa8bc3fc8", `"message_user_mentions" ("message_id")`],
    ["IDX_16395c9069e88c5f93cd658e9a", `"message_user_mentions" ("user_id")`],
    ["IDX_30114cbe788f0affbd8b8bf1f1", `"message_role_mentions" ("message_id")`],
    ["IDX_ce866308ad8ddf9b6abce06b33", `"message_role_mentions" ("role_id")`],
    ["IDX_900f52a6d0f53bdcb2e9079017", `"message_channel_mentions" ("message_id")`],
    ["IDX_724f8b11056c706429933bdf87", `"message_stickers" ("message_id")`],
    ["IDX_5d7ddc8a5f9c167f548625e772", `"member_roles" ("index")`],
    ["IDX_saved_message_user_id", `"saved_messages" ("user_id")`],
];

export class ScaleIndexes1791173948267 implements MigrationInterface {
    name = "ScaleIndexes1791173948267";

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const [name, on] of added) {
            const [{ exists }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [on.slice(0, on.indexOf(" "))]);
            if (exists) await queryRunner.query(`CREATE INDEX IF NOT EXISTS "${name}" ON ${on}`);
        }
        for (const [name] of redundant) await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const [name, on] of redundant) await queryRunner.query(`CREATE INDEX IF NOT EXISTS "${name}" ON ${on}`);
        for (const [name] of added) await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
    }
}
