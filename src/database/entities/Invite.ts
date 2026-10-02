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

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, RelationId, Index } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Channel } from "./Channel";
import { Guild } from "./Guild";
import { Member } from "./Member";
import { User } from "./User";
import { InviteType, PublicInvite } from "@spacebar/schemas/api/guilds/Invite";
import { PublicChannel } from "@spacebar/schemas";
import { Recipient } from "./Recipient";
import { DiscordApiErrors } from "@spacebar/util/util";

export const PublicInviteRelation = ["inviter", "guild", "channel"];

@Entity({
    name: "invites",
})
export class Invite extends BaseClassWithoutId {
    @PrimaryColumn()
    code: string;

    @Column()
    temporary: boolean;

    @Column()
    uses: number;

    @Column()
    max_uses: number;

    @Column()
    max_age: number;

    @Column()
    created_at: Date;

    @Column({ nullable: true })
    expires_at?: Date;

    @Column({ nullable: true })
    @RelationId((invite: Invite) => invite.guild)
    @Index("IDX_invites_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_invite_guild_id" })
    @ManyToOne(() => Guild, (guild) => guild.invites, {
        onDelete: "CASCADE",
    })
    guild: Guild;

    @Column({ nullable: true })
    @RelationId((invite: Invite) => invite.channel)
    @Index("IDX_invites_channel_id")
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_invite_channel_id" })
    @ManyToOne(() => Channel, {
        onDelete: "CASCADE",
    })
    channel: Channel;

    @Column({ nullable: true })
    @RelationId((invite: Invite) => invite.inviter)
    inviter_id?: string;

    @JoinColumn({ name: "inviter_id", foreignKeyConstraintName: "FK_invite_inviter_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    inviter: User;

    @Column({ nullable: true })
    @RelationId((invite: Invite) => invite.target_user)
    target_user_id: string;

    @JoinColumn({ name: "target_user_id", foreignKeyConstraintName: "FK_invite_target_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    target_user?: string; // could be used for "User specific invites" https://github.com/spacebarchat/server/issues/326

    @Column({ nullable: true })
    target_user_type?: number;

    @Column({ nullable: true })
    vanity_url?: boolean;

    @Column()
    flags: number;

    isExpired() {
        if (this.max_age !== 0 && this.expires_at && this.expires_at < new Date()) return true;
        if (this.max_uses !== 0 && this.uses >= this.max_uses) return true;
        return false;
    }
    async loadGroupRecipients() {
        if (this.guild_id || !this.channel) return this;
        this.channel.recipients = await Recipient.find({ where: { channel_id: this.channel_id }, relations: { user: true } });
        return this;
    }

    toPublicJSON(): PublicInvite {
        if (!this.guild_id)
            return {
                code: this.code,
                type: InviteType.GROUP_DM,
                channel: {
                    id: this.channel.id,
                    type: this.channel.type,
                    name: this.channel.name ?? null,
                    icon: this.channel.icon ?? null,
                    recipients: this.channel.recipients
                        ?.filter((r) => r.user)
                        .map((r) => ({ id: r.user.id, username: r.user.username, global_name: r.user.global_name ?? null, avatar: r.user.avatar ?? null })),
                } as unknown as PublicChannel,
                inviter: this.inviter?.toPartialUser(),
                flags: this.flags,
                expires_at: this.expires_at ? new Date(this.expires_at).toISOString() : null,
                approximate_member_count: this.channel.recipients?.length,
            };
        return {
            code: this.code,
            type: InviteType.GUILD, // TODO: support other invite types
            channel: this.channel.toJSON(),
            guild_id: this.guild_id,
            guild: this.guild.toInviteGuild(),
            profile: this.guild.toGuildProfile(),
            inviter: this.inviter?.toPartialUser(),
            flags: this.flags,
            expires_at: this.expires_at ? new Date(this.expires_at).toISOString() : null,
            approximate_member_count: this.guild.member_count,
            approximate_presence_count: this.guild.presence_count,
            is_nickname_changeable: true, // TODO
            new_member: true, // TODO
            roles: [], // TODO
            show_verification_form: false, // TODO
            target_type: undefined, // TODO
            target_user: undefined, // TODO
            target_users_job_status: undefined, // TODO
        };
    }

    toMetadataJSON(): PublicInvite & { uses: number; max_uses: number; max_age: number; temporary: boolean; created_at: string } {
        return {
            ...this.toPublicJSON(),
            uses: this.uses,
            max_uses: this.max_uses,
            max_age: this.max_age,
            temporary: this.temporary,
            created_at: new Date(this.created_at).toISOString(),
        };
    }

    static async joinGuild(user_id: string, code: string) {
        const invite = await Invite.findOneOrFail({ where: { code } });
        if (invite.isExpired()) {
            await Invite.delete({ code });
            throw DiscordApiErrors.UNKNOWN_INVITE;
        }
        if (await Member.exists({ where: { id: user_id, guild_id: invite.guild_id } })) return { invite, new_member: false };

        await Member.addToGuild(user_id, invite.guild_id, false, {
            source_invite_code: invite.code,
            join_source_type: invite.vanity_url ? 6 : 5,
            inviter_id: invite.inviter_id ?? null,
        });
        if (invite.uses++ >= invite.max_uses && invite.max_uses !== 0) await Invite.delete({ code });
        else await invite.save();

        return { invite, new_member: true };
    }
}
