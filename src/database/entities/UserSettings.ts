/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

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

import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { CustomStatus, FriendSourceFlags, GuildFolder, UserSettingsUpdateSchema } from "@spacebar/schemas";
import { PreloadedUserSettings } from "discord-protos";
import { JsonObject, JsonValue } from "@protobuf-ts/runtime";

const THEMES = ["dark", "light", "darker", "midnight"] as const;
const FRIEND_SOURCE_MUTUAL_FRIENDS = 2;
const FRIEND_SOURCE_MUTUAL_GUILDS = 4;
const FRIEND_SOURCE_ALL = 14;

@Entity({
    name: "user_settings",
})
export class UserSettings extends BaseClassWithoutId {
    @PrimaryGeneratedColumn()
    index: string;

    @Column({ nullable: true })
    afk_timeout: number = 3600;

    @Column({ nullable: true })
    allow_accessibility_detection: boolean = true;

    @Column({ nullable: true })
    animate_emoji: boolean = true;

    @Column({ nullable: true })
    animate_stickers: number = 0;

    @Column({ nullable: true })
    contact_sync_enabled: boolean = false;

    @Column({ nullable: true })
    convert_emoticons: boolean = false;

    @Column({ nullable: true, type: "jsonb" })
    custom_status: CustomStatus | null = null;

    @Column({ nullable: true })
    default_guilds_restricted: boolean = false;

    @Column({ nullable: true })
    detect_platform_accounts: boolean = false;

    @Column({ nullable: true })
    developer_mode: boolean = false;

    @Column({ nullable: true })
    disable_games_tab: boolean = true;

    @Column({ nullable: true })
    enable_tts_command: boolean = false;

    @Column({ nullable: true })
    explicit_content_filter: number = 0;

    @Column({ nullable: true })
    friend_discovery_flags: number = 0;

    @Column({ nullable: true, type: "jsonb" })
    friend_source_flags: FriendSourceFlags = { all: true };

    @Column({ nullable: true })
    gateway_connected: boolean = false;

    @Column({ nullable: true })
    gif_auto_play: boolean = false;

    @Column({ nullable: true, type: "jsonb" })
    guild_folders: GuildFolder[] = []; // every top guild is displayed as a "folder"

    @Column({ nullable: true, type: "jsonb" })
    guild_positions: string[] = []; // guild ids ordered by position

    @Column({ nullable: true })
    inline_attachment_media: boolean = true;

    @Column({ nullable: true })
    inline_embed_media: boolean = true;

    @Column({ nullable: true })
    locale: string = "en-US"; // en_US

    @Column({ nullable: true })
    message_display_compact: boolean = false;

    @Column({ nullable: true })
    native_phone_integration_enabled: boolean = true;

    @Column({ nullable: true })
    render_embeds: boolean = true;

    @Column({ nullable: true })
    render_reactions: boolean = true;

    @Column({ nullable: true, type: "jsonb" })
    restricted_guilds: string[] = [];

    @Column({ nullable: true })
    show_current_game: boolean = true;

    @Column({ nullable: true })
    status: "online" | "offline" | "dnd" | "idle" | "invisible" = "online";

    @Column({ nullable: true })
    stream_notifications_enabled: boolean = false;

    @Column({ nullable: true })
    theme: "dark" | "light" | "darker" | "midnight" = "dark"; // dark

    @Column({ nullable: true })
    timezone_offset: number = 0; // e.g -60

    @Column({ nullable: true })
    view_nsfw_guilds: boolean = true;

    toLegacy(proto?: PreloadedUserSettings) {
        const { textAndImages: text, privacy, voiceAndVideo: voice, status, localization, appearance, gameLibrary, guildFolders } = proto ?? {};
        const flags = privacy?.friendSourceFlags?.value ?? FRIEND_SOURCE_ALL;
        const custom = status?.customStatus;
        const expires = Number(custom?.expiresAtMs ?? 0);
        return {
            ...this,
            index: undefined,
            activity_restricted_guild_ids: privacy?.activityRestrictedGuildIds.map(String) ?? [],
            activity_joining_restricted_guild_ids: privacy?.activityJoiningRestrictedGuildIds.map(String) ?? [],
            afk_timeout: voice?.afkTimeout?.value ?? 60,
            allow_accessibility_detection: privacy?.allowAccessibilityDetection ?? false,
            allow_activity_party_privacy_friends: privacy?.allowActivityPartyPrivacyFriends?.value ?? true,
            allow_activity_party_privacy_voice_channel: privacy?.allowActivityPartyPrivacyVoiceChannel?.value ?? true,
            animate_emoji: text?.animateEmoji?.value ?? true,
            animate_stickers: text?.animateStickers?.value ?? 0,
            contact_sync_enabled: privacy?.contactSyncEnabled?.value ?? false,
            convert_emoticons: text?.convertEmoticons?.value ?? true,
            custom_status:
                custom && (custom.text || custom.emojiName)
                    ? {
                          text: custom.text || null,
                          emoji_id: custom.emojiId ? String(custom.emojiId) : null,
                          emoji_name: custom.emojiName || null,
                          expires_at: expires ? new Date(expires).toISOString() : null,
                      }
                    : null,
            default_guilds_restricted: privacy?.defaultGuildsRestricted ?? false,
            detect_platform_accounts: privacy?.detectPlatformAccounts?.value ?? true,
            developer_mode: appearance?.developerMode ?? false,
            disable_games_tab: gameLibrary?.disableGamesTab?.value ?? false,
            enable_tts_command: text?.enableTtsCommand?.value ?? true,
            explicit_content_filter: text?.explicitContentFilter?.value ?? 1,
            friend_discovery_flags: privacy?.friendDiscoveryFlags?.value ?? 0,
            friend_source_flags:
                (flags & FRIEND_SOURCE_ALL) === FRIEND_SOURCE_ALL
                    ? { all: true }
                    : { mutual_friends: !!(flags & FRIEND_SOURCE_MUTUAL_FRIENDS), mutual_guilds: !!(flags & FRIEND_SOURCE_MUTUAL_GUILDS) },
            gif_auto_play: text?.gifAutoPlay?.value ?? true,
            guild_folders:
                guildFolders?.folders.map((folder) => ({
                    guild_ids: folder.guildIds.map(String),
                    id: folder.id ? Number(folder.id.value) : null,
                    name: folder.name?.value ?? null,
                    color: folder.color ? Number(folder.color.value) : null,
                })) ?? this.guild_folders,
            guild_positions: guildFolders?.guildPositions.map(String) ?? this.guild_positions,
            inline_attachment_media: text?.inlineAttachmentMedia?.value ?? true,
            inline_embed_media: text?.inlineEmbedMedia?.value ?? true,
            locale: localization?.locale?.value || this.locale,
            message_display_compact: text?.messageDisplayCompact?.value ?? false,
            native_phone_integration_enabled: voice?.nativePhoneIntegrationEnabled?.value ?? true,
            passwordless: privacy?.passwordless?.value ?? true,
            render_embeds: text?.renderEmbeds?.value ?? true,
            render_reactions: text?.renderReactions?.value ?? true,
            restricted_guilds: privacy?.restrictedGuildIds.map(String) ?? [],
            show_current_game: status?.showCurrentGame?.value ?? true,
            status: status?.status?.value || this.status,
            stream_notifications_enabled: voice?.streamNotificationsEnabled?.value ?? true,
            theme: THEMES[(appearance?.theme ?? 0) - 1] ?? "dark",
            timezone_offset: localization?.timezoneOffset?.value ?? this.timezone_offset,
            view_nsfw_commands: text?.viewNsfwCommands?.value ?? false,
            view_nsfw_guilds: text?.viewNsfwGuilds?.value ?? false,
        };
    }

    static toProtoCategories(body: UserSettingsUpdateSchema) {
        const categories: Record<string, JsonObject> = {};
        const set = (category: string, key: string, value: JsonValue | undefined) => {
            if (value !== undefined) categories[category] = { ...categories[category], [key]: value };
        };
        const ids = (list?: string[]) => list?.map(String);
        const sources = body.friend_source_flags;
        const custom = body.custom_status;

        set("voiceAndVideo", "afkTimeout", body.afk_timeout);
        set("voiceAndVideo", "nativePhoneIntegrationEnabled", body.native_phone_integration_enabled);
        set("voiceAndVideo", "streamNotificationsEnabled", body.stream_notifications_enabled);
        set("privacy", "activityRestrictedGuildIds", ids(body.activity_restricted_guild_ids));
        set("privacy", "activityJoiningRestrictedGuildIds", ids(body.activity_joining_restricted_guild_ids));
        set("privacy", "allowAccessibilityDetection", body.allow_accessibility_detection);
        set("privacy", "allowActivityPartyPrivacyFriends", body.allow_activity_party_privacy_friends);
        set("privacy", "allowActivityPartyPrivacyVoiceChannel", body.allow_activity_party_privacy_voice_channel);
        set("privacy", "contactSyncEnabled", body.contact_sync_enabled);
        set("privacy", "defaultGuildsRestricted", body.default_guilds_restricted);
        set("privacy", "detectPlatformAccounts", body.detect_platform_accounts);
        set("privacy", "friendDiscoveryFlags", body.friend_discovery_flags);
        set(
            "privacy",
            "friendSourceFlags",
            sources === undefined
                ? undefined
                : !sources || sources.all
                  ? FRIEND_SOURCE_ALL
                  : (sources.mutual_friends ? FRIEND_SOURCE_MUTUAL_FRIENDS : 0) | (sources.mutual_guilds ? FRIEND_SOURCE_MUTUAL_GUILDS : 0),
        );
        set("privacy", "passwordless", body.passwordless);
        set("privacy", "restrictedGuildIds", ids(body.restricted_guilds));
        set("privacy", "slayerSdkReceiveDmsInGame", body.slayer_sdk_receive_dms_in_game);
        set("textAndImages", "animateEmoji", body.animate_emoji);
        set("textAndImages", "animateStickers", body.animate_stickers);
        set("textAndImages", "convertEmoticons", body.convert_emoticons);
        set("textAndImages", "enableTtsCommand", body.enable_tts_command);
        set("textAndImages", "explicitContentFilter", body.explicit_content_filter);
        set("textAndImages", "gifAutoPlay", body.gif_auto_play);
        set("textAndImages", "inlineAttachmentMedia", body.inline_attachment_media);
        set("textAndImages", "inlineEmbedMedia", body.inline_embed_media);
        set("textAndImages", "messageDisplayCompact", body.message_display_compact);
        set("textAndImages", "renderEmbeds", body.render_embeds);
        set("textAndImages", "renderReactions", body.render_reactions);
        set("textAndImages", "viewNsfwCommands", body.view_nsfw_commands);
        set("textAndImages", "viewNsfwGuilds", body.view_nsfw_guilds);
        set("appearance", "developerMode", body.developer_mode);
        set("appearance", "theme", body.theme && THEMES.indexOf(body.theme) + 1);
        set("gameLibrary", "disableGamesTab", body.disable_games_tab);
        set("localization", "locale", body.locale);
        set("localization", "timezoneOffset", body.timezone_offset);
        set("status", "status", body.status);
        set("status", "showCurrentGame", body.show_current_game);
        set(
            "status",
            "customStatus",
            custom === undefined
                ? undefined
                : custom && {
                      text: custom.text ?? "",
                      emojiId: custom.emoji_id ?? "0",
                      emojiName: custom.emoji_name ?? "",
                      expiresAtMs: String(custom.expires_at ? new Date(custom.expires_at).getTime() : 0),
                      createdAtMs: String(Date.now()),
                  },
        );
        set(
            "guildFolders",
            "folders",
            body.guild_folders?.map((folder) => ({
                guildIds: folder.guild_ids.map(String),
                ...(folder.id != null && { id: String(folder.id) }),
                ...(folder.name != null && { name: folder.name }),
                ...(folder.color != null && { color: String(folder.color) }),
            })),
        );
        return categories;
    }

    public static async getOrDefault(userId: string) {
        // raw sql query
        const userSettingsIndex = (await this.getRepository().query('SELECT "settingsIndex" FROM users WHERE id = $1', [userId]))[0]?.settingsIndex as string | null;

        console.log(`[INFO/UserSettings] Fetched settings index for user ${userId}:`, userSettingsIndex);

        if (!userSettingsIndex) return new UserSettings();

        const settings = await UserSettings.findOne({ where: { index: userSettingsIndex } });
        if (!settings) return new UserSettings();

        return settings;
    }
}
