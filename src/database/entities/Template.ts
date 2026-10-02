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

import { Column, Entity, JoinColumn, ManyToOne, RelationId } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Guild } from "./Guild";
import { User } from "./User";
import { Random } from "@spacebar/extensions";

@Entity({
    name: "templates",
})
export class Template extends BaseClass {
    @Column({ unique: true })
    code: string;

    @Column()
    name: string;

    @Column({ nullable: true })
    description?: string;

    @Column({ nullable: true })
    usage_count?: number;

    @Column({ nullable: true })
    @RelationId((template: Template) => template.creator)
    creator_id: string;

    @JoinColumn({ name: "creator_id", foreignKeyConstraintName: "FK_template_creator_id" })
    @ManyToOne(() => User)
    creator: User;

    @Column()
    created_at: Date;

    @Column()
    updated_at: Date;

    @Column({ nullable: true })
    @RelationId((template: Template) => template.source_guild)
    source_guild_id: string;

    @JoinColumn({ name: "source_guild_id", foreignKeyConstraintName: "FK_template_source_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    source_guild: Guild;

    @Column({ type: "jsonb" })
    serialized_source_guild: Guild;

    static generateCode() {
        return Random.getString("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 12);
    }

    static serializeGuild(guild: Guild) {
        const roles = [...(guild.roles ?? [])].sort((a, b) => a.position - b.position);
        const roleIndex = new Map(roles.map((role, index) => [role.id, index]));
        const order = guild.channel_ordering ?? [];
        const channels = [...(guild.channels ?? [])].filter((c) => !c.isThread()).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        const channelIndex = new Map(channels.map((channel, index) => [channel.id, index + 1]));
        const mapChannel = (id?: string | null) => (id ? (channelIndex.get(id) ?? null) : null);

        return {
            name: guild.name,
            description: guild.description ?? null,
            region: guild.region,
            verification_level: guild.verification_level,
            default_message_notifications: guild.default_message_notifications,
            explicit_content_filter: guild.explicit_content_filter,
            preferred_locale: guild.preferred_locale,
            afk_timeout: guild.afk_timeout,
            roles: roles.map((role, index) => ({
                id: index,
                name: role.name,
                permissions: role.permissions,
                color: role.color,
                colors: role.colors,
                hoist: role.hoist,
                mentionable: role.mentionable,
                icon: role.icon ?? null,
                unicode_emoji: role.unicode_emoji ?? null,
            })),
            channels: channels.map((channel, index) => ({
                id: index + 1,
                type: channel.type,
                name: channel.name,
                position: index,
                topic: channel.topic ?? null,
                bitrate: channel.bitrate,
                user_limit: channel.user_limit,
                nsfw: channel.nsfw ?? false,
                rate_limit_per_user: channel.rate_limit_per_user ?? 0,
                parent_id: mapChannel(channel.parent_id),
                default_auto_archive_duration: channel.default_auto_archive_duration ?? null,
                default_thread_rate_limit_per_user: channel.default_thread_rate_limit_per_user ?? null,
                available_tags: channel.available_tags?.map((tag) => ({ name: tag.name, emoji_id: tag.emoji_id, emoji_name: tag.emoji_name, moderated: tag.moderated })) ?? null,
                permission_overwrites: (channel.permission_overwrites ?? [])
                    .filter((overwrite) => overwrite.type === 0 && roleIndex.has(overwrite.id))
                    .map((overwrite) => ({ id: roleIndex.get(overwrite.id), type: 0, allow: overwrite.allow, deny: overwrite.deny })),
            })),
            afk_channel_id: mapChannel(guild.afk_channel_id),
            system_channel_id: mapChannel(guild.system_channel_id),
            system_channel_flags: guild.system_channel_flags,
        } as unknown as Guild;
    }

    toJSON() {
        return {
            code: this.code,
            name: this.name,
            description: this.description ?? null,
            usage_count: this.usage_count ?? 0,
            creator_id: this.creator_id,
            creator: this.creator?.toPublicUser(),
            created_at: this.created_at,
            updated_at: this.updated_at,
            source_guild_id: this.source_guild_id,
            serialized_source_guild: this.serialized_source_guild,
            is_dirty: null,
        };
    }
}
