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

import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Snowflake } from "@spacebar/util/util/Snowflake";
import { User } from "./User";
import { AuditLogChange, AuditLogEntry, AuditLogEvents } from "@spacebar/schemas";

type AuditLogInput = {
    guild_id: string;
    user_id: string;
    action_type: AuditLogEvents;
    target_id?: string | null;
    changes?: AuditLogChange[];
    options?: AuditLog["options"];
    reason?: string | string[];
};

@Entity({
    name: "audit_logs",
})
export class AuditLog extends BaseClass {
    @Column({ nullable: true })
    @Index("IDX_audit_log_guild_id")
    guild_id: string;

    @Column({ type: "bigint", nullable: true })
    target_id: string;

    @Column({ nullable: true })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_audit_log_source_user_id" })
    @ManyToOne(() => User, (user: User) => user.id)
    user: User;

    @Column({ type: "int" })
    action_type: AuditLogEvents;

    @Column({ type: "jsonb", nullable: true })
    options?: {
        delete_member_days?: string;
        members_removed?: string;
        channel_id?: string;
        messaged_id?: string;
        message_id?: string;
        count?: string;
        id?: string;
        type?: string;
        role_name?: string;
        auto_moderation_rule_name?: string;
        auto_moderation_rule_trigger_type?: string;
    };

    @Column()
    @Column({ type: "jsonb" })
    changes: AuditLogChange[];

    @Column({ nullable: true })
    reason?: string;

    static readonly channelKeys = [
        "name",
        "type",
        "topic",
        "nsfw",
        "rate_limit_per_user",
        "bitrate",
        "user_limit",
        "rtc_region",
        "video_quality_mode",
        "default_auto_archive_duration",
        "default_thread_rate_limit_per_user",
        "permission_overwrites",
        "flags",
        "icon",
    ];

    static readonly threadKeys = ["name", "type", "archived", "locked", "auto_archive_duration", "invitable", "rate_limit_per_user", "flags", "applied_tags"];

    static diff(before: object, after: object, keys: string[]): AuditLogChange[] {
        const old = before as Record<string, unknown>;
        const now = after as Record<string, unknown>;
        return keys
            .filter((key) => JSON.stringify(old[key] ?? null) !== JSON.stringify(now[key] ?? null))
            .map((key) => ({ key, old_value: old[key] ?? undefined, new_value: now[key] ?? undefined }) as unknown as AuditLogChange);
    }

    static entry(entry: AuditLogInput) {
        const reason = Array.isArray(entry.reason) ? entry.reason[0] : entry.reason;
        return AuditLog.create({
            guild_id: entry.guild_id,
            user_id: entry.user_id,
            action_type: entry.action_type,
            target_id: entry.target_id ?? undefined,
            changes: entry.changes ?? [],
            options: entry.options,
            reason: reason ? decodeURIComponent(reason).slice(0, 512) : undefined,
        });
    }

    static async log(entry: AuditLogInput) {
        return AuditLog.entry(entry)
            .save()
            .catch((e) => console.error("[AuditLog] failed to write entry", e));
    }

    static async logMany(entries: AuditLogInput[]) {
        if (!entries.length) return;
        await AuditLog.insert(entries.map((entry) => AuditLog.entry(entry))).catch((e) => console.error("[AuditLog] failed to write entries", e));
    }

    static async logMessageDelete(guild_id: string, user_id: string, author_id: string, channel_id: string, reason?: string | string[]) {
        const previous = await AuditLog.findOne({ where: { guild_id, user_id }, order: { id: "DESC" } });
        if (
            previous?.action_type === AuditLogEvents.MESSAGE_DELETE &&
            previous.target_id === author_id &&
            previous.options?.channel_id === channel_id &&
            Date.now() - Snowflake.deconstruct(previous.id).timestamp < 5 * 60 * 1000
        ) {
            previous.options = { ...previous.options, count: `${Number(previous.options.count ?? 1) + 1}` };
            return previous.save().catch((e) => console.error("[AuditLog] failed to write entry", e));
        }
        return AuditLog.log({ guild_id, user_id, action_type: AuditLogEvents.MESSAGE_DELETE, target_id: author_id, options: { channel_id, count: "1" }, reason });
    }

    toAuditLogEntry(): AuditLogEntry {
        return {
            id: this.id,
            action_type: this.action_type,
            reason: this.reason,
            user_id: this.user_id,
            target_id: this.target_id,
            options: this.options,
            changes: this.changes,
        } satisfies AuditLogEntry;
    }
}
