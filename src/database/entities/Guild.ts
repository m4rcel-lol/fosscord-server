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

import { AfterLoad, Column, Entity, JoinColumn, ManyToOne, OneToMany, RelationId } from "typeorm";
import { arrayRemove } from "@spacebar/extensions";
import { Config, handleFile, Snowflake } from "@spacebar/util";
import {
    ChannelType,
    DiscoverableGuild,
    GuildDiscoveryMetadata,
    GuildHomeSettings,
    GuildMemberVerification,
    GuildOnboarding,
    GuildProfileSettings,
    GuildNsfwLevel,
    GuildPremiumTier,
    GuildProfileResponse,
    GuildVerificationLevel,
    GuildVisibilityLevel,
    GuildWelcomeScreen,
    IntegrationGuild,
} from "@spacebar/schemas";
import { Ban } from "./Ban";
import { BaseClass } from "./BaseClass";
import { Channel } from "./Channel";
import { Emoji } from "./Emoji";
import { Invite } from "./Invite";
import { Member } from "./Member";
import { Role } from "./Role";
import { Sticker } from "./Sticker";
import { Template } from "./Template";
import { User } from "./User";
import { VoiceState } from "./VoiceState";
import { Webhook } from "./Webhook";
import { Categories } from "./Categories";
import { InviteGuild } from "@spacebar/schemas/api/guilds/Invite";
// TODO: application_command_count, application_command_counts: {1: 0, 2: 0, 3: 0}
// TODO: guild_scheduled_events
// TODO: stage_instances
// TODO: threads
// TODO:
// "keywords": [
// 		"Genshin Impact",
// 		"Paimon",
// 		"Honkai Impact",
// 		"ARPG",
// 		"Open-World",
// 		"Waifu",
// 		"Anime",
// 		"Genshin",
// 		"miHoYo",
// 		"Gacha"
// 	],

export interface GuildIncidentsData {
    invites_disabled_until: string | null;
    dms_disabled_until: string | null;
    dm_spam_detected_at: string | null;
    raid_detected_at: string | null;
    lockdown_duration_hours?: number | null;
}

export const GuildPowerupFeatures = [
    "ENHANCED_ROLE_COLORS",
    "GUILD_TAGS",
    "GUILD_TAGS_BADGE_PACK_PETS",
    "GUILD_TAGS_BADGE_PACK_FLEX",
    "GUILD_TAGS_BADGE_PACK_PLANT",
    "GUILD_TAGS_BADGE_PACK_CREEPY_CRAWLIES",
    "GUILD_THEME",
];

export const GuildBoostFeatures = ["ANIMATED_BANNER", "ANIMATED_ICON", "BANNER", "INVITE_SPLASH", "ROLE_ICONS", "VANITY_URL", "PREMIUM_TIER_3_OVERRIDE", ...GuildPowerupFeatures];

export const GuildBoostCount = 33;

export const PublicGuildRelations = [
    "channels",
    "emojis",
    "roles",
    "stickers",
    "voice_states",
    // "members",		// TODO: These are public, but all members should not be fetched.
    // "members.user",
];

@Entity({
    name: "guilds",
})
export class Guild extends BaseClass {
    @Column({ type: String, nullable: true })
    @RelationId((guild: Guild) => guild.afk_channel)
    afk_channel_id?: string | null;

    @JoinColumn({ name: "afk_channel_id", foreignKeyConstraintName: "FK_guild_afk_channel_id" })
    @ManyToOne(() => Channel)
    afk_channel?: Channel;

    @Column({ nullable: true })
    afk_timeout?: number;

    // * commented out -> use owner instead
    // application id of the guild creator if it is bot-created
    // @Column({ nullable: true })
    // application?: string;

    @JoinColumn({ name: "ban_ids", foreignKeyConstraintName: "FK_guild_ban_ids" })
    @OneToMany(() => Ban, (ban: Ban) => ban.guild, {
        cascade: true,
        orphanedRowAction: "delete",
    })
    bans: Ban[];

    @Column({ nullable: true })
    banner?: string;

    @Column({ nullable: true })
    default_message_notifications?: number;

    @Column({ nullable: true })
    description?: string;

    @Column({ nullable: true })
    discovery_splash?: string;

    @Column({ nullable: true })
    explicit_content_filter?: number;

    @Column({ type: "varchar", array: true })
    features: string[] = []; //TODO use enum
    //TODO: https://discord.com/developers/docs/resources/guild#guild-object-guild-features

    @Column({ type: "int2", nullable: true })
    primary_category_id?: number;

    @Column({ nullable: true })
    icon?: string;

    @Column()
    large?: boolean = false;

    @Column({ nullable: true })
    max_members?: number;

    @Column({ nullable: true })
    max_presences?: number;

    @Column({ nullable: true })
    max_video_channel_users?: number;

    @Column({ nullable: true })
    member_count?: number;

    @Column({ nullable: true })
    presence_count?: number; // users online

    @OneToMany(() => Member, (member: Member) => member.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    members: Member[];

    @JoinColumn({ name: "role_ids", foreignKeyConstraintName: "FK_guild_role_ids" })
    @OneToMany(() => Role, (role: Role) => role.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    roles: Role[];

    @JoinColumn({ name: "channel_ids", foreignKeyConstraintName: "FK_guild_channel_ids" })
    @OneToMany(() => Channel, (channel: Channel) => channel.guild, {
        cascade: true,
        orphanedRowAction: "delete",
    })
    channels: Channel[];

    @Column({ nullable: true })
    @RelationId((guild: Guild) => guild.template)
    template_id?: string;

    @JoinColumn({ name: "template_id", referencedColumnName: "id", foreignKeyConstraintName: "FK_guild_template_id" })
    @ManyToOne(() => Template)
    template: Template;

    @JoinColumn({ name: "emoji_ids", foreignKeyConstraintName: "FK_guild_emoji_ids" })
    @OneToMany(() => Emoji, (emoji: Emoji) => emoji.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    emojis: Emoji[];

    @JoinColumn({ name: "sticker_ids", foreignKeyConstraintName: "FK_guild_sticker_ids" })
    @OneToMany(() => Sticker, (sticker: Sticker) => sticker.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    stickers: Sticker[];

    @JoinColumn({ name: "invite_ids", foreignKeyConstraintName: "FK_guild_invite_ids" })
    @OneToMany(() => Invite, (invite: Invite) => invite.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    invites: Invite[];

    @JoinColumn({ name: "voice_state_ids", foreignKeyConstraintName: "FK_guild_voice_state_ids" })
    @OneToMany(() => VoiceState, (voicestate: VoiceState) => voicestate.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    voice_states: VoiceState[];

    @JoinColumn({ name: "webhook_ids", foreignKeyConstraintName: "FK_guild_webhook_ids" })
    @OneToMany(() => Webhook, (webhook: Webhook) => webhook.guild, {
        cascade: true,
        orphanedRowAction: "delete",
        onDelete: "CASCADE",
    })
    webhooks: Webhook[];

    @Column({ nullable: true })
    mfa_level?: number;

    @Column()
    name: string;

    @Column({ nullable: true })
    @RelationId((guild: Guild) => guild.owner)
    owner_id?: string; // optional to allow for ownerless guilds

    @JoinColumn({ name: "owner_id", referencedColumnName: "id", foreignKeyConstraintName: "FK_guild_owner_id" })
    @ManyToOne(() => User)
    owner?: User; // optional to allow for ownerless guilds

    @Column({ nullable: true })
    preferred_locale?: string;

    @Column({ nullable: true })
    premium_subscription_count?: number;

    @Column()
    premium_tier?: number; // crowd premium level

    @Column({ type: String, nullable: true })
    @RelationId((guild: Guild) => guild.public_updates_channel)
    public_updates_channel_id: string | null;

    @JoinColumn({ name: "public_updates_channel_id", foreignKeyConstraintName: "FK_guild_public_updates_channel_id" })
    @ManyToOne(() => Channel)
    public_updates_channel?: Channel;

    @Column({ type: String, nullable: true })
    @RelationId((guild: Guild) => guild.rules_channel)
    rules_channel_id?: string | null;

    @JoinColumn({ name: "rules_channel_id", foreignKeyConstraintName: "FK_guild_rules_channel_id" })
    @ManyToOne(() => Channel)
    rules_channel?: string;

    @Column({ nullable: true })
    region?: string;

    @Column({ nullable: true })
    splash?: string;

    @Column({ type: String, nullable: true })
    @RelationId((guild: Guild) => guild.system_channel)
    system_channel_id?: string | null;

    @JoinColumn({ name: "system_channel_id", foreignKeyConstraintName: "FK_guild_system_channel_id" })
    @ManyToOne(() => Channel)
    system_channel?: Channel;

    @Column({ nullable: true })
    system_channel_flags?: number;

    @Column()
    unavailable: boolean = false;

    @Column({ nullable: true })
    verification_level?: number;

    /**
     * DEPRECATED: Look at the new Guild onboarding screens.
     */
    @Column({ type: "jsonb" })
    welcome_screen: GuildWelcomeScreen;

    @Column({ nullable: true, type: "int8" })
    @RelationId((guild: Guild) => guild.widget_channel)
    widget_channel_id?: string;

    @JoinColumn({ name: "widget_channel_id", foreignKeyConstraintName: "FK_guild_widget_channel_id" })
    @ManyToOne(() => Channel)
    widget_channel?: Channel;

    @Column()
    widget_enabled: boolean = true;

    @Column({ nullable: true })
    nsfw_level?: number;

    @Column()
    nsfw: boolean = false;

    // TODO: nested guilds
    @Column({ nullable: true })
    parent?: string;

    // only for developer portal
    permissions?: number;

    //new guild settings, 11/08/2022:
    @Column({ nullable: true })
    premium_progress_bar_enabled: boolean = false;

    @Column({ select: false, type: "int8", array: true })
    channel_ordering: string[];

    @Column({ default: 0 })
    discovery_weight: number = 0;

    @Column({ default: false })
    discovery_excluded: boolean = false;

    @Column({ type: String, nullable: true })
    vanity_url_code?: string | null;

    @Column({ type: "jsonb", nullable: true })
    profile?: GuildProfileSettings | null;

    @Column({ type: "jsonb", nullable: true })
    home_settings?: GuildHomeSettings | null;

    @Column({ type: "jsonb", nullable: true })
    onboarding?: GuildOnboarding | null;

    @Column({ type: "jsonb", nullable: true })
    member_verification?: GuildMemberVerification | null;

    @Column({ type: "jsonb", nullable: true })
    discovery_metadata?: GuildDiscoveryMetadata | null;

    @Column({ type: "jsonb", nullable: true })
    incidents_data?: GuildIncidentsData | null;

    premium_features?: {
        features: string[];
        additional_emoji_slots: number;
        additional_sticker_slots: number;
        additional_sound_slots: number;
    };

    @AfterLoad()
    applyBoostPerks() {
        this.premium_tier = GuildPremiumTier.TIER_3;
        this.premium_subscription_count = Math.max(this.premium_subscription_count ?? 0, GuildBoostCount);
        this.features = [...new Set([...(this.features ?? []), ...GuildBoostFeatures])];
        this.premium_features = { features: GuildPowerupFeatures, additional_emoji_slots: 200, additional_sticker_slots: 55, additional_sound_slots: 40 };
    }

    async toDiscoverableGuild(): Promise<DiscoverableGuild | null> {
        if (!this.features.includes("DISCOVERABLE")) {
            return null;
        }

        return {
            id: this.id,
            name: this.name,
            icon: this.icon ?? null,
            description: this.description ?? null,
            banner: this.banner ?? null,
            splash: this.splash ?? null,
            discovery_splash: this.discovery_splash ?? null,
            features: this.features,
            vanity_url_code: this.vanity_url_code ?? null,
            preferred_locale: this.preferred_locale || "en",
            premium_subscription_count: this.premium_subscription_count ?? 0,
            approximate_member_count: this.member_count ?? 1,
            /*await Member.countBy({
                guild_id: this.id,
            }),*/
            approximate_presence_count: this.presence_count ?? 0,
            /* await Member.countBy({
                guild_id: this.id,
                user: {
                    sessions: {
                        status: "online",
                    },
                },
            }),*/
            emojis: this.emojis?.map((e) => e.toJSON()) ?? undefined,
            emoji_count: this.emojis ? this.emojis.length : undefined,
            stickers: this.stickers?.map((s) => s.toJSON()) ?? undefined,
            sticker_count: this.stickers ? this.stickers.length : undefined,
            auto_removed: false,
            primary_category_id: this.primary_category_id!,
            keywords: [],
            is_published: false,
            reasons_to_join: [],
            created_at: new Date(Snowflake.deconstruct(this.id).timestamp).toISOString(), // TODO: make column
            primary_category: this.primary_category_id
                ? (
                      await Categories.findOneOrFail({
                          where: {
                              id: this.primary_category_id!,
                          },
                      })
                  ).toJSON()
                : undefined,
        };
    }

    toIntegrationGuild(): IntegrationGuild {
        return {
            id: this.id,
            name: this.name,
            icon: this.icon ?? null,
        } satisfies IntegrationGuild;
    }

    static async createGuild(body: {
        name?: string;
        icon?: string | null;
        owner_id?: string;
        roles?: Partial<Role>[];
        channels?: Partial<Channel>[];
        system_channel_id?: string | null;
        source_guild_id: string | null;
    }) {
        const guild_id = Snowflake.generate();

        const guild = await Guild.create({
            id: guild_id,
            name: body.name || "Spacebar",
            icon: await handleFile(`/icons/${guild_id}`, body.icon as string),
            owner_id: body.owner_id, // TODO: need to figure out a way for ownerless guilds and multiply-owned guilds
            presence_count: 0,
            member_count: 0, // will automatically be increased by addMember()
            mfa_level: 0,
            preferred_locale: "en-US",
            premium_subscription_count: GuildBoostCount,
            premium_tier: GuildPremiumTier.TIER_3,
            system_channel_flags: 4, // defaults effect: suppress the setup tips to save performance
            nsfw_level: 0,
            verification_level: 0,
            welcome_screen: {
                enabled: false,
                description: "",
                welcome_channels: [],
            },
            channel_ordering: [],
            afk_timeout: Config.get().defaults.guild.afkTimeout,
            default_message_notifications: Config.get().defaults.guild.defaultMessageNotifications,
            explicit_content_filter: Config.get().defaults.guild.explicitContentFilter,
            features: [...new Set([...Config.get().guild.defaultFeatures, ...GuildBoostFeatures])],
            max_members: Config.get().limits.guild.maxMembers,
            max_presences: Config.get().defaults.guild.maxPresences,
            max_video_channel_users: Config.get().defaults.guild.maxVideoChannelUsers,
            region: Config.get().regions.default,
        }).save();

        // we have to create the role _after_ the guild because else we would get a foreign key error
        // TODO: make the @everyone a pseudorole that is dynamically generated at runtime so we can save storage
        await Role.create({
            id: guild_id,
            guild_id: guild_id,
            color: 0,
            colors: { primary_color: 0 },
            hoist: false,
            managed: false,
            mentionable: false,
            name: "@everyone",
            permissions: "2248473465835073",
            position: 0,
            icon: undefined,
            unicode_emoji: undefined,
            flags: 0, // TODO?
        }).save();

        const roleIds = new Map<string, string>([["0", guild_id]]);
        for (const [index, role] of (body.roles ?? []).entries()) {
            const id = role.id === body.source_guild_id || `${role.id}` === "0" ? guild_id : Snowflake.generate();
            roleIds.set(`${role.id}`, id);
            await Role.create({
                color: 0,
                hoist: false,
                managed: false,
                mentionable: false,
                permissions: "0",
                flags: 0,
                position: index,
                ...role,
                colors: role.colors ?? { primary_color: role.color ?? 0 },
                guild_id,
                id,
            }).save();
        }

        if (!body.channels || !body.channels.length) {
            body.channels = [
                { id: "00", type: 4, name: "Text Channels" },
                { id: "01", type: 0, name: "general", nsfw: false, parent_id: "00" },
                { id: "10", type: 4, name: "Voice Channels" },
                { id: "11", type: 2, name: "General", parent_id: "10" },
            ];
        }

        const ids = new Map();

        body.channels.forEach((x) => {
            if (x.id != null) {
                ids.set(x.id, Snowflake.generate());
            }
        });

        const ordered = body.channels.map((channel) => ({ ...channel, id: ids.get(channel.id) || Snowflake.generate(), parent_id: ids.get(channel.parent_id) }));
        for (const channel of [...ordered.filter((c) => !c.parent_id), ...ordered.filter((c) => c.parent_id)]) {
            await Channel.createChannel(
                {
                    ...channel,
                    guild_id,
                    permission_overwrites: (channel.permission_overwrites ?? [])
                        .filter((o) => o.type !== 0 || roleIds.has(`${o.id}`))
                        .map((o) => ({ ...o, id: o.type === 0 ? roleIds.get(`${o.id}`)! : o.id })),
                },
                body.owner_id,
                {
                    keepId: true,
                    skipExistsCheck: true,
                    skipPermissionCheck: true,
                    skipEventEmit: true,
                },
            );
        }
        guild.channel_ordering = ordered.map((c) => c.id);
        await Guild.update({ id: guild_id }, { channel_ordering: guild.channel_ordering });

        const textChannels = ordered.filter((channel) => channel.type === ChannelType.GUILD_TEXT);
        const systemChannelId = (
            textChannels.find((channel) => body.system_channel_id != null && body.channels![ordered.indexOf(channel)].id == body.system_channel_id) ?? textChannels[0]
        )?.id;
        if (systemChannelId) {
            guild.system_channel_id = systemChannelId;
            await Guild.update({ id: guild.id }, { system_channel_id: systemChannelId });
        }

        return guild;
    }

    /** Insert a channel into the guild ordering by parent channel id or position */
    static async insertChannelInOrder(guild_id: string, channel_id: string, position: number, guild?: Guild): Promise<number>;
    static async insertChannelInOrder(guild_id: string, channel_id: string, parent_id: string, guild?: Guild): Promise<number>;
    static async insertChannelInOrder(guild_id: string, channel_id: string, insertPoint: string | number, guild?: Guild): Promise<number>;
    static async insertChannelInOrder(guild_id: string, channel_id: string, insertPoint: string | number, guild?: Guild): Promise<number> {
        if (!guild)
            guild = await Guild.findOneOrFail({
                where: { id: guild_id },
                select: { channel_ordering: true },
            });

        guild.channel_ordering ??= [];

        let position;
        if (typeof insertPoint == "string") position = guild.channel_ordering.indexOf(insertPoint) + 1;
        else position = insertPoint;

        arrayRemove(guild.channel_ordering, channel_id);

        guild.channel_ordering.splice(position, 0, channel_id);
        await Guild.update({ id: guild_id }, { channel_ordering: guild.channel_ordering });
        return position;
    }

    toJSON(): Guild {
        return {
            ...this,
            unavailable: this.unavailable == false ? undefined : true,
            channel_ordering: undefined,
            discovery_weight: undefined,
            discovery_excluded: undefined,
            vanity_url_code: this.vanity_url_code ?? null,
            incidents_data: this.incidents_data ?? null,
            profile: this.profile?.tag ? ({ tag: this.profile.tag, badge: this.profile.badge_hash ?? null } as GuildProfileSettings) : null,
            home_settings: undefined,
            onboarding: undefined,
            member_verification: undefined,
            discovery_metadata: undefined,
            parent: undefined,
            primary_category_id: undefined,
            nsfw: undefined,
            template_id: undefined,
            presence_count: undefined,
        };
    }

    toInviteGuild(): InviteGuild {
        return {
            id: this.id,
            name: this.name,
            icon: this.icon ?? null,
            description: this.description ?? null,
            banner: this.banner ?? null,
            splash: this.splash ?? null,
            verification_level: this.verification_level ?? GuildVerificationLevel.NONE,
            features: this.features,
            vanity_url_code: this.vanity_url_code ?? null,
            premium_subscription_count: this.premium_subscription_count,
            premium_tier: this.premium_tier ?? GuildPremiumTier.NONE,
            nsfw: this.nsfw,
            nsfw_level: this.nsfw_level ?? GuildNsfwLevel.DEFAULT,
        } satisfies InviteGuild;
    }

    toGuildProfile(): GuildProfileResponse {
        const profile = this.profile ?? {};
        return {
            id: this.id,
            name: this.name,
            icon_hash: this.icon ?? null,
            member_count: this.member_count ?? 0,
            online_count: this.presence_count ?? 0,
            description: this.description ?? "",
            brand_color_primary: profile.brand_color_primary ?? undefined,
            game_application_ids: profile.game_application_ids ?? [],
            game_activity: {},
            tag: profile.tag ?? null,
            badge: profile.badge ?? null,
            badge_color_primary: profile.badge_color_primary ?? "",
            badge_color_secondary: profile.badge_color_secondary ?? "",
            badge_hash: profile.badge_hash ?? "",
            traits: (profile.traits ?? []).map((trait) => ({
                ...trait,
                emoji_id: trait.emoji_id ?? null,
                emoji_name: trait.emoji_name ?? null,
                emoji_animated: trait.emoji_animated ?? false,
            })),
            features: this.features,
            visibility: profile.visibility ?? GuildVisibilityLevel.PUBLIC,
            custom_banner_hash: profile.custom_banner_hash ?? null,
            premium_subscription_count: this.premium_subscription_count ?? 0,
            premium_tier: this.premium_tier ?? GuildPremiumTier.NONE,
            banner_hash: null,
        } satisfies GuildProfileResponse;
    }
}
