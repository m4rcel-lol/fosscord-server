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

import { In } from "typeorm";
import { Channel, Guild, Message, Report, ReportSnapshot, User } from "@spacebar/database";
import { CreateReportSchema } from "@spacebar/schemas";

type MenuNode = { key?: string; header?: string; children?: [string, number][] };
type Menu = { root_node_id: number; nodes: Record<string, MenuNode> };

const SNOWFLAKE = /^\d{1,20}$/;
const snowflake = (value: unknown) => (typeof value === "string" && SNOWFLAKE.test(value) ? value : null);

const pathLabels = (menu: Menu, breadcrumbs: number[]) =>
    breadcrumbs.slice(1).flatMap((id, i) => {
        const parent = menu.nodes[breadcrumbs[i]];
        const label = parent?.children?.find(([, child]) => child === id)?.[0];
        return label ? [label] : [];
    });

const pickAuthor = (user: User) => ({
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    global_name: user.global_name ?? null,
    avatar: user.avatar ?? null,
});

export async function createReport(type: string, body: CreateReportSchema, reporterId: string, menu: Menu) {
    const report = Report.create({
        type,
        reporter_id: reporterId,
        guild_id: snowflake(body.guild_id),
        channel_id: snowflake(body.channel_id),
        message_id: snowflake(body.message_id),
        application_id: snowflake(body.application_id),
        stage_instance_id: snowflake(body.stage_instance_id),
        guild_scheduled_event_id: snowflake(body.guild_scheduled_event_id),
        widget_id: typeof body.widget_id === "string" ? body.widget_id.slice(0, 64) : null,
        reported_user_id: snowflake(body.reported_user_id ?? body.user_id),
        breadcrumbs: body.breadcrumbs,
        elements: Object.fromEntries(
            Object.entries(body.elements ?? {}).map(([key, value]) => [
                key.slice(0, 100),
                Array.isArray(value) ? value.map((v) => String(v).slice(0, 200)) : String(value).slice(0, 4000),
            ]),
        ),
        reason: pathLabels(menu, body.breadcrumbs).join(" › "),
    });

    let snapshot: ReportSnapshot | null = null;
    if (report.message_id && report.channel_id) {
        const message = await Message.findOne({ where: { id: report.message_id, channel_id: report.channel_id }, relations: { author: true, attachments: true } });
        if (message) {
            report.reported_user_id = message.author_id ?? report.reported_user_id;
            report.guild_id ??= message.guild_id ?? null;
            snapshot = {
                author: message.author ? pickAuthor(message.author) : undefined,
                content: message.content ?? "",
                attachments: (message.attachments ?? []).map((a) => ({ filename: a.filename, url: a.toJSON().url, content_type: a.content_type ?? null })),
                embeds: message.embeds?.length ?? 0,
                sent_at: message.timestamp?.toISOString(),
            };
        }
    } else if (report.reported_user_id) {
        const user = await User.findOne({ where: { id: report.reported_user_id }, select: { id: true, username: true, discriminator: true, global_name: true, avatar: true } });
        if (user) snapshot = { author: pickAuthor(user) };
    }
    if (!snapshot && report.guild_id) {
        const guild = await Guild.findOne({ where: { id: report.guild_id }, select: { id: true, name: true } });
        if (guild) snapshot = { name: guild.name };
    }
    report.snapshot = snapshot;
    return report.save();
}

export async function describeReports(reports: Report[]) {
    const userIds = [...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_user_id, r.resolved_by]).filter((id): id is string => !!id))];
    const guildIds = [...new Set(reports.map((r) => r.guild_id).filter((id): id is string => !!id))];
    const channelIds = [...new Set(reports.map((r) => r.channel_id).filter((id): id is string => !!id))];
    const messageIds = reports.map((r) => r.message_id).filter((id): id is string => !!id);
    const [users, guilds, channels, messages] = await Promise.all([
        userIds.length ? User.find({ where: { id: In(userIds) }, select: { id: true, username: true, discriminator: true, global_name: true, avatar: true, disabled: true } }) : [],
        guildIds.length ? Guild.find({ where: { id: In(guildIds) }, select: { id: true, name: true, icon: true } }) : [],
        channelIds.length ? Channel.find({ where: { id: In(channelIds) }, select: { id: true, name: true, type: true } }) : [],
        messageIds.length ? Message.find({ where: { id: In(messageIds) }, select: { id: true } }) : [],
    ]);
    const user = (id?: string | null) => {
        if (!id) return null;
        const found = users.find((u) => u.id === id);
        return found ? { ...pickAuthor(found), disabled: found.disabled } : { id };
    };
    return reports.map((r) => {
        const guild = guilds.find((g) => g.id === r.guild_id);
        const channel = channels.find((c) => c.id === r.channel_id);
        return {
            id: r.id,
            type: r.type,
            status: r.status,
            reason: r.reason,
            elements: r.elements,
            created_at: r.created_at,
            reporter: user(r.reporter_id),
            reported_user: user(r.reported_user_id),
            guild: r.guild_id ? (guild ? { id: guild.id, name: guild.name, icon: guild.icon ?? null } : { id: r.guild_id }) : null,
            channel: r.channel_id ? (channel ? { id: channel.id, name: channel.name ?? null, type: channel.type } : { id: r.channel_id }) : null,
            message_id: r.message_id ?? null,
            message_exists: !!r.message_id && messages.some((m) => m.id === r.message_id),
            application_id: r.application_id ?? null,
            guild_scheduled_event_id: r.guild_scheduled_event_id ?? null,
            stage_instance_id: r.stage_instance_id ?? null,
            snapshot: r.snapshot ?? null,
            resolved_by: user(r.resolved_by),
            resolved_at: r.resolved_at ?? null,
            resolution_note: r.resolution_note ?? null,
        };
    });
}
