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

export class MoreForeignKeyIndexes1791137482916 implements MigrationInterface {
    name = "MoreForeignKeyIndexes1791137482916";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_applications_guild_id" ON "applications" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_applications_owner_id" ON "applications" ("owner_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_applications_team_id" ON "applications" ("team_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachments_channel_id" ON "attachments" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_id" ON "audit_logs" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_backup_codes_user_id" ON "backup_codes" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bans_executor_id" ON "bans" ("executor_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bans_user_id" ON "bans" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_channels_owner_id" ON "channels" ("owner_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_emojis_application_id" ON "emojis" ("application_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_emojis_user_id" ON "emojis" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_owner_id" ON "guilds" ("owner_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_afk_channel_id" ON "guilds" ("afk_channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_public_updates_channel_id" ON "guilds" ("public_updates_channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_rules_channel_id" ON "guilds" ("rules_channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_system_channel_id" ON "guilds" ("system_channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_widget_channel_id" ON "guilds" ("widget_channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guilds_template_id" ON "guilds" ("template_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invites_inviter_id" ON "invites" ("inviter_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invites_target_user_id" ON "invites" ("target_user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_guild_id" ON "messages" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_member_id" ON "messages" ("member_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notes_target_id" ON "notes" ("target_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_stickers_pack_id" ON "stickers" ("pack_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_stickers_user_id" ON "stickers" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_team_members_team_id" ON "team_members" ("team_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_team_members_user_id" ON "team_members" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_teams_owner_user_id" ON "teams" ("owner_user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_templates_creator_id" ON "templates" ("creator_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_templates_source_guild_id" ON "templates" ("source_guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhooks_application_id" ON "webhooks" ("application_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhooks_source_channel_id" ON "webhooks" ("source_channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhooks_source_guild_id" ON "webhooks" ("source_guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhooks_user_id" ON "webhooks" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_security_keys_user_id" ON "security_keys" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_streams_channel_id" ON "streams" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_streams_owner_id" ON "streams" ("owner_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_stream_sessions_stream_id" ON "stream_sessions" ("stream_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_stream_sessions_user_id" ON "stream_sessions" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_automod_rules_creator_id" ON "automod_rules" ("creator_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cloud_attachments_channel_id" ON "cloud_attachments" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cloud_attachments_user_id" ON "cloud_attachments" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_soundboard_sounds_user_id" ON "soundboard_sounds" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_application_authorizations_application_id" ON "application_authorizations" ("application_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_application_command_permissions_application_id" ON "application_command_permissions" ("application_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_application_command_permissions_guild_id" ON "application_command_permissions" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guild_scheduled_events_creator_id" ON "guild_scheduled_events" ("creator_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_message_reference_id" ON "messages" ("message_reference_id") WHERE "message_reference_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_thread_id" ON "messages" ("thread_id") WHERE "thread_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_application_id" ON "messages" ("application_id") WHERE "application_id" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_owner_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_team_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_attachments_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backup_codes_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bans_executor_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bans_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_channels_owner_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_emojis_application_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_emojis_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_owner_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_afk_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_public_updates_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_rules_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_system_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_widget_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_template_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invites_inviter_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invites_target_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_member_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notes_target_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stickers_pack_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stickers_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_members_team_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_members_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_teams_owner_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_templates_creator_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_templates_source_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhooks_application_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhooks_source_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhooks_source_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhooks_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_security_keys_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_streams_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_streams_owner_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stream_sessions_stream_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stream_sessions_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automod_rules_creator_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cloud_attachments_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cloud_attachments_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_soundboard_sounds_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_application_authorizations_application_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_application_command_permissions_application_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_application_command_permissions_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guild_scheduled_events_creator_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_message_reference_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_thread_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_application_id"`);
    }
}
