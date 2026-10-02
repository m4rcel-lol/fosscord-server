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

import { HTTPError } from "lambert-server/HTTPError";
import { BeforeInsert, BeforeUpdate, Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne, Not, PrimaryGeneratedColumn, RelationId } from "typeorm";
import { Stopwatch } from "@spacebar/extensions";
import { Config, emitEvent, DiscordApiErrors } from "@spacebar/util/util";
import {
    AvatarDecorationData,
    ChannelOverride,
    Collectibles,
    DefaultUserGuildSettings,
    DisplayNameStyle,
    ProfileCollectible,
    PublicMember,
    PublicMemberProjection,
    UserGuildSettings,
} from "@spacebar/schemas";
import { ReadyGuildDTO } from "../../util/dtos/ReadyGuildDTO";
import { GuildCreateEvent, GuildDeleteEvent, GuildMemberAddEvent, GuildMemberRemoveEvent, GuildMemberUpdateEvent, MessageCreateEvent } from "../../util/interfaces/Event";
import { BaseClassWithoutId } from "./BaseClass";
import { Ban } from "./Ban";
import { Channel } from "./Channel";
import { Guild, PublicGuildRelations } from "./Guild";
import { Message } from "./Message";
import { Role } from "./Role";
import { User } from "./User";

export const MemberPrivateProjection: (keyof Member)[] = [
    "id",
    "guild",
    "guild_id",
    "deaf",
    "joined_at",
    "last_message_id",
    "mute",
    "nick",
    "pending",
    "premium_since",
    "roles",
    "settings",
    "user",
    "avatar",
    "banner",
    "bio",
    "theme_colors",
    "pronouns",
    "communication_disabled_until",
    "flags",
];

@Entity({
    name: "members",
})
@Index(["id", "guild_id"], { unique: true })
export class Member extends BaseClassWithoutId {
    @PrimaryGeneratedColumn()
    index: string;

    @Column()
    @RelationId((member: Member) => member.user)
    id: string;

    @JoinColumn({ name: "id", foreignKeyConstraintName: "FK_member_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;

    @Column()
    @RelationId((member: Member) => member.guild)
    @Index("IDX_members_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_member_guild_id" })
    @ManyToOne(() => Guild, {
        onDelete: "CASCADE",
    })
    guild: Guild;

    @Column({ nullable: true })
    nick?: string;

    @JoinTable({
        name: "member_roles",
        joinColumn: {
            name: "index",
            referencedColumnName: "index",
            foreignKeyConstraintName: "FK_member_role_member_index",
        },
        inverseJoinColumn: {
            name: "role_id",
            referencedColumnName: "id",
            foreignKeyConstraintName: "FK_member_role_role_id",
        },
    })
    @ManyToMany(() => Role, { cascade: true })
    roles: Role[];

    @Column()
    joined_at: Date;

    @Column({ type: "bigint", nullable: true })
    premium_since?: number;

    @Column()
    deaf: boolean;

    @Column()
    mute: boolean;

    @Column()
    pending: boolean;

    @Column({ type: String, nullable: true })
    source_invite_code?: string | null;

    @Column({ type: Number, nullable: true })
    join_source_type?: number | null;

    @Column({ type: "bigint", nullable: true })
    inviter_id?: string | null;

    @Column({ type: "jsonb", nullable: true, select: false })
    onboarding_responses?: {
        onboarding_responses: string[];
        onboarding_prompts_seen: Record<string, number>;
        onboarding_responses_seen: Record<string, number>;
    } | null;

    @Column({ type: "jsonb", select: false })
    settings: UserGuildSettings;

    @Column({ type: "int8", nullable: true })
    last_message_id?: string;

    /**
	@JoinColumn({ name: "id" })
	@ManyToOne(() => User, {
		onDelete: "DO NOTHING",
	// do not auto-kick force-joined members just because their joiners left the server
	}) **/
    @Column({ nullable: true })
    joined_by: string;

    @Column({ nullable: true })
    avatar?: string;

    @Column({ nullable: true })
    banner: string;

    @Column()
    bio: string;

    @Column({ nullable: true, type: "int4", array: true })
    theme_colors?: number[]; // TODO: Separate `User` and `UserProfile` models

    @Column({ nullable: true })
    pronouns?: string;

    @Column({ nullable: true, type: Date })
    communication_disabled_until: Date | null;

    // TODO: add this when we have proper read receipts
    // @Column({ type: "jsonb" })
    // read_state: ReadState;

    @Column({ type: "jsonb", nullable: true })
    avatar_decoration_data?: AvatarDecorationData;

    @Column({ type: "jsonb", nullable: true })
    display_name_styles?: DisplayNameStyle;

    @Column({ type: "jsonb", nullable: true })
    collectibles?: Collectibles;

    @Column({ type: "jsonb", nullable: true })
    profile_collectibles?: ProfileCollectible[] | null;

    @Column({ type: "int", default: 0 })
    flags: number = 0;

    @BeforeUpdate()
    @BeforeInsert()
    validate() {
        if (this.nick) {
            this.nick = this.nick.split("\n").join("");
            this.nick = this.nick.split("\t").join("");
        }
        if (this.nick === "") this.nick = undefined;
        if (this.pronouns === "") this.pronouns = undefined;
    }

    static async IsInGuildOrFail(user_id: string, guild_id: string) {
        if (
            await Member.count({
                where: { id: user_id, guild_id },
            })
        )
            return;
        throw new HTTPError("You are not member of this guild", 403);
    }

    static async removeFromGuild(user_id: string, guild_id: string) {
        const guild = await Guild.findOneOrFail({
            select: { owner_id: true },
            where: { id: guild_id },
        });
        if (guild.owner_id === user_id) throw new Error("The owner cannot be removed from the guild");
        const member = await Member.findOneOrFail({
            where: { id: user_id, guild_id },
            relations: { user: true },
        });

        // use promise all to execute all promises at the same time -> save time
        return Promise.all([
            Member.delete({
                id: user_id,
                guild_id,
            }),
            Guild.decrement({ id: guild_id }, "member_count", 1),

            emitEvent({
                event: "GUILD_DELETE",
                data: {
                    id: guild_id,
                },
                user_id: user_id,
            } satisfies GuildDeleteEvent),
            emitEvent({
                event: "GUILD_MEMBER_REMOVE",
                data: { guild_id, user: member.user.toPublicUser() },
                guild_id,
            } satisfies GuildMemberRemoveEvent),
        ]);
    }

    static async addRole(user_id: string, guild_id: string, role_id: string) {
        const [member] = await Promise.all([
            Member.findOneOrFail({
                where: { id: user_id, guild_id },
                relations: { user: true, roles: true },
            }),
            Role.findOneOrFail({
                where: { id: role_id, guild_id },
                select: { id: true },
            }),
        ]);
        if (!member.roles.some((x) => x.id === role_id)) member.roles.push(Role.create({ id: role_id }));

        await Promise.all([
            member.save(),
            emitEvent({
                event: "GUILD_MEMBER_UPDATE",
                data: {
                    ...member.toPublicMember(),
                    guild_id,
                    user: member.user.toPublicUser(),
                    roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
                },
                guild_id,
            } satisfies GuildMemberUpdateEvent),
        ]);
    }

    static async removeRole(user_id: string, guild_id: string, role_id: string) {
        const [member] = await Promise.all([
            Member.findOneOrFail({
                where: { id: user_id, guild_id },
                relations: { user: true, roles: true },
            }),
            Role.findOneOrFail({ where: { id: role_id, guild_id } }),
        ]);
        member.roles = member.roles.filter((x) => x.id !== role_id);

        await Promise.all([
            member.save(),
            emitEvent({
                event: "GUILD_MEMBER_UPDATE",
                data: {
                    ...member.toPublicMember(),
                    guild_id,
                    user: member.user.toPublicUser(),
                    roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
                },
                guild_id,
            } satisfies GuildMemberUpdateEvent),
        ]);
    }

    static async changeNickname(user_id: string, guild_id: string, nickname: string) {
        const member = await Member.findOneOrFail({
            where: {
                id: user_id,
                guild_id,
            },
            relations: { user: true, roles: true },
        });

        // @ts-expect-error Member nickname is nullable
        member.nick = nickname || null;

        await Promise.all([
            member.save(),

            emitEvent({
                event: "GUILD_MEMBER_UPDATE",
                data: {
                    ...member.toPublicMember(),
                    guild_id,
                    user: member.user.toPublicUser(),
                    roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
                },
                guild_id,
            } satisfies GuildMemberUpdateEvent),
        ]);
    }

    static async addToGuild(
        user_id: string,
        guild_id: string,
        isRegistration: boolean = false,
        source?: { source_invite_code?: string | null; join_source_type?: number; inviter_id?: string | null },
    ) {
        const totalSw = Stopwatch.startNew();
        const incSw = Stopwatch.startNew();
        const logTrace = (...data: unknown[]) => {
            if (process.env.LOG_VERBOSE_TRACES !== "true") return;
            console.log("[Member.addToGuild]", ...data, `[${totalSw.elapsed().toString()} (+${incSw.getElapsedAndReset().totalMilliseconds}ms)]`);
        };

        if (!isRegistration) {
            const isBanned = Ban.exists({ where: { guild_id, user_id } });
            const isMember = Member.exists({ where: { id: user_id, guild_id } });

            if (await isBanned) throw DiscordApiErrors.USER_BANNED;
            logTrace("Check bans");

            if (await isMember) throw new HTTPError("You are already a member of this guild", 400);
            logTrace("Check existing membership");

            const { maxGuilds } = Config.get().limits.user;
            const guild_count = await Member.count({ where: { id: user_id } });
            if (guild_count >= maxGuilds) {
                throw new HTTPError(`You are at the ${maxGuilds} guild limit.`, 403);
            }
            logTrace("Enforce max guilds");
        }

        const guild = await Guild.findOneOrFail({
            where: {
                id: guild_id,
            },
            relations: Object.fromEntries(PublicGuildRelations.map((i) => [i, true])), //TODO: clean up
            relationLoadStrategy: "query",
        });
        const channelPositionsGuild = await Guild.findOneOrFail({
            where: { id: guild_id },
            select: { channel_ordering: true },
        });
        logTrace("Find guild");

        const newMember = Member.create({
            id: user_id,
            guild_id,
            nick: undefined,
            joined_at: new Date(),
            deaf: false,
            mute: false,
            pending: !!guild.features.includes("MEMBER_VERIFICATION_GATE_ENABLED") && !!guild.member_verification?.form_fields?.length && guild.owner_id !== user_id,
            bio: "",
            source_invite_code: source?.source_invite_code ?? null,
            join_source_type: source?.join_source_type ?? null,
            inviter_id: source?.inviter_id ?? null,
            roles: [Role.create({ id: guild_id })], // @everyone role
            // read_state: {},
            settings: {
                guild_id: null,
                mute_config: null,
                mute_scheduled_events: false,
                flags: 0,
                hide_muted_channels: false,
                notify_highlights: 0,
                channel_overrides: {},
                message_notifications: guild.default_message_notifications,
                mobile_push: true,
                muted: false,
                suppress_everyone: false,
                suppress_roles: false,
                version: 0,
            },
            // Member.save is needed because else the roles relations wouldn't be updated
        });

        let memberCount = 0;
        let memberPreview: PublicMember[] = [];
        if (!isRegistration) {
            for await (const channel of guild.channels) {
                channel.position = await Channel.calculatePosition(channel.id, guild_id, channelPositionsGuild);
            }

            logTrace("Reorder channels");

            memberCount = isRegistration ? 0 : await Member.count({ where: { guild_id } });
            logTrace("Get member count");

            memberPreview = (
                await Member.find({
                    where: {
                        guild_id,
                        user: {
                            id: Not(user_id),
                            sessions: {
                                status: Not("invisible" as const), // lol typescript?
                            },
                        },
                    },
                    relations: { user: true, roles: true },
                    take: 10,
                })
            ).map((member) => member.toPublicMember());
            logTrace("Calculate member preview");
        }

        const user = await User.getPublicUser(user_id);
        logTrace("Get user");

        await Promise.all([
            newMember.save(), // TODO: can we somehow insert the roles manually? We have no entity for this... Would skip a few select's
            Guild.increment({ id: guild_id }, "member_count", 1),
            emitEvent({
                event: "GUILD_MEMBER_ADD",
                data: {
                    ...newMember.toPublicMember(),
                    user: user,
                    guild_id,
                },
                guild_id,
                origin: "util/entities/Member.ts:377/addToGuild(user_id, guild_id)",
            } satisfies GuildMemberAddEvent),
            isRegistration
                ? null
                : emitEvent({
                      event: "GUILD_CREATE",
                      data: {
                          ...new ReadyGuildDTO(guild).toJSON(),
                          members: [...memberPreview, { ...newMember.toPublicMember(), user }],
                          member_count: memberCount + 1,
                          guild_hashes: {},
                          guild_scheduled_events: [],
                          joined_at: newMember.joined_at,
                          presences: [],
                          stage_instances: [],
                          threads: [],
                          embedded_activities: [],
                          voice_states: guild.voice_states.map((x) => x.toPublicVoiceState()),
                      },
                      user_id,
                  } satisfies GuildCreateEvent),
        ]);
        logTrace("Save member info");

        const welcomeChannelId = guild.system_channel_id;
        if (welcomeChannelId && (await Channel.exists({ where: { id: welcomeChannelId } }))) {
            // Send a welcome message
            const message = Message.create({
                type: 7,
                guild_id: guild.id,
                channel_id: welcomeChannelId,
                author: user,
                timestamp: new Date(),
                reactions: [],
                attachments: [],
                embeds: [],
                sticker_items: [],
                edited_timestamp: undefined,
                mentions: [],
                mention_channels: [],
                mention_roles: [],
                mention_everyone: false,
            });

            await Promise.all([
                message.insert(),
                emitEvent({
                    event: "MESSAGE_CREATE",
                    channel_id: message.channel_id,
                    data: message.toJSON(),
                } satisfies MessageCreateEvent),
                Channel.update({ id: welcomeChannelId }, { last_message_id: message.id }),
            ]);
            logTrace("Send welcome message");
        }
    }

    toPublicMember() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const member: any = {};
        PublicMemberProjection.forEach((x) => {
            member[x] = this[x];
        });

        if (this.roles) member.roles = this.roles.map((x: Role) => x.id);
        if (this.user) member.user = this.user.toPublicUser();

        return member as PublicMember;
    }

    static async updateGuildSettings(user_id: string, guild_id: string, body: Partial<UserGuildSettings>) {
        const member = await Member.findOneOrFail({
            where: { id: user_id, guild_id },
            select: { settings: true, index: true, id: true, guild_id: true },
        });
        const settings = { ...DefaultUserGuildSettings, ...(member.settings ?? {}) };
        const { channel_overrides, ...rest } = body;
        Object.assign(settings, rest);
        if (channel_overrides) {
            settings.channel_overrides = { ...(settings.channel_overrides ?? {}) };
            for (const [channel_id, override] of Object.entries(channel_overrides))
                settings.channel_overrides[channel_id] = { ...(settings.channel_overrides[channel_id] ?? {}), ...override, channel_id } as ChannelOverride;
        }
        settings.version = (settings.version ?? 0) + 1;
        settings.guild_id = guild_id;
        member.settings = settings;
        await member.save();

        const entry = {
            ...settings,
            channel_overrides: Object.entries(settings.channel_overrides ?? {}).map(([channel_id, override]) => ({ ...override, channel_id })),
        };
        await emitEvent({ event: "USER_GUILD_SETTINGS_UPDATE", user_id, data: entry });
        return entry;
    }

    toSupplementalMember() {
        return {
            member: { ...this.toPublicMember(), roles: (this.roles ?? []).map((r) => r.id).filter((id) => id !== this.guild_id) },
            source_invite_code: this.source_invite_code ?? null,
            join_source_type: this.join_source_type ?? 0,
            inviter_id: this.inviter_id ?? null,
            integration_type: null,
        };
    }
}
