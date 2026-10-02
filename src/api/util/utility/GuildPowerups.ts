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

export const GUILD_POWERUPS_APPLICATION_ID = "1340102344645283891";

interface GuildPowerupDefinition {
    sku_id: string;
    category: "level" | "perk";
    name: string;
    summary: string;
    description: string;
    boost_price: number;
    dependent_sku_id?: string;
    features: string[];
    additional_emoji_slots?: number;
    additional_sticker_slots?: number;
    additional_sound_slots?: number;
}

const POWERUPS: GuildPowerupDefinition[] = [
    {
        sku_id: "1341586379779604621",
        category: "level",
        name: "Level 1",
        summary: "Level 1",
        description: "More emoji, sticker and soundboard slots, an animated server icon and a custom invite background.",
        boost_price: 2,
        features: ["ANIMATED_ICON", "INVITE_SPLASH", "AUDIO_BITRATE_128_KBPS"],
        additional_emoji_slots: 50,
        additional_sticker_slots: 10,
        additional_sound_slots: 16,
    },
    {
        sku_id: "1341586379779604622",
        category: "level",
        name: "Level 2",
        summary: "Level 2",
        description: "A server banner, role icons, 1080p streams and 50MB uploads for everyone.",
        boost_price: 5,
        dependent_sku_id: "1341586379779604621",
        features: ["BANNER", "ROLE_ICONS", "AUDIO_BITRATE_256_KBPS", "VIDEO_QUALITY_1080_60FPS", "MAX_FILE_SIZE_50_MB"],
        additional_emoji_slots: 50,
        additional_sticker_slots: 15,
        additional_sound_slots: 12,
    },
    {
        sku_id: "1341586379779604623",
        category: "level",
        name: "Level 3",
        summary: "Level 3",
        description: "An animated banner, a custom invite link, 384kbps audio and 100MB uploads for everyone.",
        boost_price: 7,
        dependent_sku_id: "1341586379779604622",
        features: ["ANIMATED_BANNER", "VANITY_URL", "AUDIO_BITRATE_384_KBPS", "MAX_FILE_SIZE_100_MB"],
        additional_emoji_slots: 100,
        additional_sticker_slots: 30,
        additional_sound_slots: 12,
    },
    {
        sku_id: "1493634428604252161",
        category: "perk",
        name: "Server Theme",
        summary: "Server Theme",
        description: "Give your server its own colors that everyone sees while they're in it.",
        boost_price: 3,
        features: ["GUILD_THEME"],
    },
    {
        sku_id: "1351706802684952639",
        category: "perk",
        name: "Server Tag",
        summary: "Server Tag",
        description: "Let members rep your server with a tag and badge next to their name.",
        boost_price: 3,
        features: ["GUILD_TAGS"],
    },
    {
        sku_id: "1395150519886024775",
        category: "perk",
        name: "Pets Badge Pack",
        summary: "Pets Badge Pack",
        description: "Extra badges for your Server Tag.",
        boost_price: 3,
        features: ["GUILD_TAGS_BADGE_PACK_PETS"],
    },
    {
        sku_id: "1395150923734581339",
        category: "perk",
        name: "Flex Badge Pack",
        summary: "Flex Badge Pack",
        description: "Extra badges for your Server Tag.",
        boost_price: 5,
        features: ["GUILD_TAGS_BADGE_PACK_FLEX"],
    },
    {
        sku_id: "1466209416922667288",
        category: "perk",
        name: "Plant Badge Pack",
        summary: "Plant Badge Pack",
        description: "Extra badges for your Server Tag.",
        boost_price: 3,
        features: ["GUILD_TAGS_BADGE_PACK_PLANT"],
    },
    {
        sku_id: "1466209416931055898",
        category: "perk",
        name: "Creepy Crawlies Badge Pack",
        summary: "Creepy Crawlies Badge Pack",
        description: "Extra badges for your Server Tag.",
        boost_price: 2,
        features: ["GUILD_TAGS_BADGE_PACK_CREEPY_CRAWLIES"],
    },
    {
        sku_id: "1354906318279807056",
        category: "perk",
        name: "Enhanced Role Styles",
        summary: "Enhanced Role Styles",
        description: "Gradient and holographic role colors for every role in your server.",
        boost_price: 3,
        features: ["ENHANCED_ROLE_COLORS"],
    },
    {
        sku_id: "1387197800336330924",
        category: "perk",
        name: "Custom Invite Link",
        summary: "Custom Invite Link",
        description: "Pick a memorable invite link for your server.",
        boost_price: 5,
        features: ["VANITY_URL"],
    },
    {
        sku_id: "1479204648718958665",
        category: "perk",
        name: "250MB Uploads",
        summary: "250MB Uploads",
        description: "Everyone in your server can upload files up to 250MB.",
        boost_price: 3,
        features: ["MAX_FILE_SIZE_250_MB"],
    },
];

const sku = (powerup: GuildPowerupDefinition) => ({
    id: powerup.sku_id,
    type: 5,
    application_id: GUILD_POWERUPS_APPLICATION_ID,
    product_line: 9,
    name: powerup.name,
    slug: powerup.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    flags: 0,
    access_type: 1,
    features: [],
    show_age_gate: false,
    premium: false,
    dependent_sku_id: powerup.dependent_sku_id ?? null,
    manifest_labels: null,
    release_date: null,
    powerup_metadata: {
        boost_price: powerup.boost_price,
        guild_features: {
            features: powerup.features,
            additional_emoji_slots: powerup.additional_emoji_slots ?? 0,
            additional_sticker_slots: powerup.additional_sticker_slots ?? 0,
            additional_sound_slots: powerup.additional_sound_slots ?? 0,
        },
        animated_image_url: null,
        static_image_url: null,
    },
});

export function guildPowerupListings() {
    return POWERUPS.map((powerup) => ({
        id: powerup.sku_id,
        summary: powerup.summary,
        description: powerup.description,
        published: true,
        benefits: [],
        powerup_metadata: {
            category_type: powerup.category,
            animated_image_url: null,
            static_image_url: null,
            store_removal_date: null,
            deactivation_cooldown_period_days: 0,
        },
        sku: sku(powerup),
    }));
}

export function guildPowerupEntitlements(guild_id: string, user_id: string) {
    return POWERUPS.filter((powerup) => powerup.category === "perk").map((powerup) => ({
        id: powerup.sku_id,
        sku_id: powerup.sku_id,
        application_id: GUILD_POWERUPS_APPLICATION_ID,
        user_id,
        guild_id,
        type: 4,
        deleted: false,
        consumed: false,
        starts_at: null,
        ends_at: null,
        gift_code_flags: 0,
        sku: sku(powerup),
    }));
}
