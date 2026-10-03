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

import fs from "node:fs";
import path from "node:path";
import { In } from "typeorm";
import { Channel, Guild, User, UserReport } from "@spacebar/database";
import { getUrlSignature, NewUrlSignatureData } from "@spacebar/util";

type MenuNode = { children?: [string, number][] };
const menus = new Map<string, Record<string, MenuNode> | null>();

const menuNodes = (type: string) => {
    if (!menus.has(type)) {
        try {
            const file = path.join(__dirname, "..", "..", "..", "..", "assets", "temp_report_menu_responses", `${type}.json`);
            menus.set(type, JSON.parse(fs.readFileSync(file, "utf-8")).nodes ?? null);
        } catch {
            menus.set(type, null);
        }
    }
    return menus.get(type) ?? null;
};

export function reportReasons(type: string, breadcrumbs: number[]) {
    const nodes = menuNodes(type);
    if (!nodes) return [];
    return breadcrumbs.slice(1).flatMap((id, i) => nodes[String(breadcrumbs[i])]?.children?.find((child) => child[1] === id)?.[0] ?? []);
}

const brief = (user?: User) =>
    user ? { id: user.id, username: user.username, discriminator: user.discriminator, global_name: user.global_name ?? null, avatar: user.avatar ?? null } : null;

export async function describeReports(reports: UserReport[], viewer: { ip?: string; userAgent?: string }) {
    const userIds = [...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_user_id, r.resolved_by]).filter((id): id is string => !!id))];
    const guildIds = [...new Set(reports.map((r) => r.guild_id).filter((id): id is string => !!id))];
    const channelIds = [...new Set(reports.map((r) => r.channel_id).filter((id): id is string => !!id))];
    const [users, guilds, channels] = await Promise.all([
        userIds.length ? User.find({ where: { id: In(userIds) }, select: { id: true, username: true, discriminator: true, global_name: true, avatar: true } }) : [],
        guildIds.length ? Guild.find({ where: { id: In(guildIds) }, select: { id: true, name: true, icon: true } }) : [],
        channelIds.length ? Channel.find({ where: { id: In(channelIds) }, select: { id: true, name: true, type: true } }) : [],
    ]);
    const sign = (url: string) => {
        try {
            return getUrlSignature(new NewUrlSignatureData({ ...viewer, url }))
                .applyToUrl(url)
                .toString();
        } catch {
            return url;
        }
    };
    return reports.map((report) => ({
        id: report.id,
        type: report.type,
        status: report.status,
        created_at: report.created_at,
        reasons: reportReasons(report.type, report.breadcrumbs ?? []),
        elements: report.elements ?? {},
        reporter: brief(users.find((u) => u.id === report.reporter_id)) ?? (report.reporter_id ? { id: report.reporter_id } : null),
        reported_user: brief(users.find((u) => u.id === report.reported_user_id)) ?? (report.reported_user_id ? { id: report.reported_user_id } : null),
        guild: guilds.find((g) => g.id === report.guild_id) ?? (report.guild_id ? { id: report.guild_id } : null),
        channel: channels.find((c) => c.id === report.channel_id) ?? (report.channel_id ? { id: report.channel_id } : null),
        message_id: report.message_id ?? null,
        snapshot: report.snapshot ? { ...report.snapshot, attachments: (report.snapshot.attachments ?? []).map((a) => ({ ...a, url: sign(a.url) })) } : null,
        resolved_by: brief(users.find((u) => u.id === report.resolved_by)) ?? null,
        resolved_at: report.resolved_at ?? null,
        violation_id: report.violation_id ?? null,
    }));
}
