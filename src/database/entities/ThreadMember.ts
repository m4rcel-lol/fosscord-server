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

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId } from "typeorm";
import { ThreadCreateEvent, ThreadDeleteEvent, ThreadMembersUpdateEvent } from "../../util/interfaces";
import { emitEvent, Snowflake } from "@spacebar/util/util";
import { BaseClassWithoutId } from "./BaseClass";
import { Channel } from "./Channel";
import { HTTPError } from "lambert-server/HTTPError";
import { Member } from "./Member";

export interface ThreadMemberMuteConfig {
    end_time?: Date;
    selected_time_window?: number;
}

export enum ThreadMemberFlags {
    NONE = 0,
    HAS_INTERACTED = 1 << 0,
    ALL_MESSAGES = 1 << 1,
    ONLY_MENTIONS = 1 << 2,
    NO_MESSAGES = 1 << 3,
}

export type PublicThreadMember = ReturnType<ThreadMember["toJSON"]>;

@Entity("thread_members")
@Index(["id", "member_idx"], { unique: true })
export class ThreadMember extends BaseClassWithoutId {
    @PrimaryGeneratedColumn()
    index: string;

    @Column()
    @RelationId((member: ThreadMember) => member.channel)
    id: string;

    @JoinColumn({ name: "id", foreignKeyConstraintName: "FK_thread_member_channel_id" })
    @ManyToOne(() => Channel, {
        onDelete: "CASCADE",
    })
    channel: Channel;

    @Column()
    @RelationId((member: ThreadMember) => member.member)
    member_idx: string;

    @JoinColumn({ name: "member_idx", foreignKeyConstraintName: "FK_thread_member_member_id" })
    @ManyToOne(() => Member, {
        onDelete: "CASCADE",
    })
    member: Member;

    @Column({ type: "int8", nullable: true })
    @Index("IDX_thread_members_user_id")
    user_id: string;

    @Column()
    join_timestamp: Date;

    @Column()
    muted: boolean;

    @Column({ nullable: true, type: "jsonb" })
    mute_config?: ThreadMemberMuteConfig;

    @Column()
    flags: ThreadMemberFlags;

    toJSON() {
        return {
            id: this.id,
            user_id: this.user_id ?? this.member?.id,
            join_timestamp: new Date(this.join_timestamp).toISOString(),
            flags: this.flags,
            muted: this.muted,
            mute_config: this.mute_config ?? null,
            ...(this.member?.user ? { member: this.member.toPublicMember() } : {}),
        };
    }

    static async IsInThreadOrFail(user_id: string, thread_id: string) {
        if (await ThreadMember.existsBy({ id: thread_id, user_id })) return true;
        throw new HTTPError("You are not member of this thread", 403);
    }

    static async join(thread: Channel, user_id: string, flags: number = ThreadMemberFlags.HAS_INTERACTED) {
        const existing = await ThreadMember.findOne({ where: { id: thread.id, user_id } });
        if (existing) return { member: existing, added: false };

        const guildMember = await Member.findOneOrFail({ where: { id: user_id, guild_id: thread.guild_id! }, select: { index: true, id: true } });
        const member = ThreadMember.create({ id: thread.id, user_id, member_idx: guildMember.index, join_timestamp: new Date(), muted: false, flags });
        await member.save();
        await Channel.getRepository().increment({ id: thread.id }, "member_count", 1);
        thread.member_count = (thread.member_count ?? 0) + 1;

        const data = {
            id: thread.id,
            guild_id: thread.guild_id!,
            member_count: Math.min(thread.member_count, 50),
            added_members: [member.toJSON()],
        };
        await emitEvent({ event: "THREAD_CREATE", data: { ...thread.toJSON(), member: member.toJSON(), newly_created: false }, user_id } satisfies ThreadCreateEvent);
        const transaction_id = Snowflake.generate();
        await Promise.all([
            emitEvent({ event: "THREAD_MEMBERS_UPDATE", data, channel_id: thread.id, transaction_id } satisfies ThreadMembersUpdateEvent),
            emitEvent({ event: "THREAD_MEMBERS_UPDATE", data, user_id, transaction_id } satisfies ThreadMembersUpdateEvent),
        ]);
        return { member, added: true };
    }

    static async leave(thread: Channel, user_id: string) {
        const existing = await ThreadMember.findOne({ where: { id: thread.id, user_id } });
        if (!existing) return false;
        await existing.remove();
        if ((thread.member_count ?? 0) > 0) {
            await Channel.getRepository().decrement({ id: thread.id }, "member_count", 1);
            thread.member_count = (thread.member_count ?? 1) - 1;
        }
        const data = {
            id: thread.id,
            guild_id: thread.guild_id!,
            member_count: Math.min(thread.member_count ?? 0, 50),
            removed_member_ids: [user_id],
        };
        const transaction_id = Snowflake.generate();
        await Promise.all([
            emitEvent({ event: "THREAD_MEMBERS_UPDATE", data, channel_id: thread.id, transaction_id } satisfies ThreadMembersUpdateEvent),
            emitEvent({ event: "THREAD_MEMBERS_UPDATE", data, user_id, transaction_id } satisfies ThreadMembersUpdateEvent),
        ]);
        if (thread.isPrivateThread())
            await emitEvent({
                event: "THREAD_DELETE",
                data: { id: thread.id, guild_id: thread.guild_id, parent_id: thread.parent_id, type: thread.type },
                user_id,
            } satisfies ThreadDeleteEvent);
        return true;
    }
}
