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

import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { Snowflake } from "@spacebar/util";

const router = Router({ mergeParams: true });

type Query<T> = { or_query?: T[]; and_query?: T[]; range?: { gte?: T; lte?: T } };
type SafetySignals = {
    unusual_dm_activity_until?: Query<number>;
    communication_disabled_until?: Query<number>;
    unusual_account_activity?: boolean;
    automod_quarantined_username?: boolean;
};
type Filter = {
    user_id?: Query<string>;
    usernames?: Query<string>;
    role_ids?: Query<string>;
    guild_joined_at?: Query<number>;
    source_invite_code?: Query<string>;
    join_source_type?: Query<number>;
    safety_signals?: SafetySignals;
    is_pending?: boolean;
};
type Cursor = { guild_joined_at?: number; user_id?: string };

router.post(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            200: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const {
            limit = 25,
            sort = 1,
            or_query = {},
            and_query = {},
            before,
            after,
        } = req.body as { limit?: number; sort?: number; or_query?: Filter; and_query?: Filter; before?: Cursor; after?: Cursor };

        const members = await Member.find({
            where: { guild_id },
            relations: { user: true, roles: true },
        });

        const joined = (m: Member) => new Date(m.joined_at).getTime();
        const names = (m: Member) => [m.nick, m.user.username, m.user.global_name].filter(Boolean).map((n) => `${n}`.toLowerCase());
        const time = (value?: Date | string | null) => (value ? new Date(value).getTime() : null);
        const signals = (m: Member, query: SafetySignals) => {
            const checks: boolean[] = [];
            const dm = time(m.unusual_dm_activity_until);
            const timeout = time(m.communication_disabled_until);
            if (query.unusual_dm_activity_until) checks.push(dm != null && inRange(dm, query.unusual_dm_activity_until.range));
            if (query.communication_disabled_until) checks.push(timeout != null && inRange(timeout, query.communication_disabled_until.range));
            if (query.automod_quarantined_username) checks.push((m.flags & 128) !== 0);
            if (query.unusual_account_activity) checks.push(false);
            return checks;
        };
        const inRange = <T>(value: T, range?: { gte?: T; lte?: T }) => !range || ((range.gte == null || value >= range.gte) && (range.lte == null || value <= range.lte));

        const andMatch = (m: Member) => {
            const roles = m.roles.map((r) => r.id);
            if (and_query.role_ids?.and_query && !and_query.role_ids.and_query.every((id) => roles.includes(id))) return false;
            if (and_query.role_ids?.or_query && !and_query.role_ids.or_query.some((id) => roles.includes(id))) return false;
            if (and_query.user_id?.or_query && !and_query.user_id.or_query.includes(m.id)) return false;
            if (and_query.usernames?.or_query && !and_query.usernames.or_query.some((q) => names(m).some((n) => n.startsWith(q.toLowerCase())))) return false;
            if (
                !inRange(
                    BigInt(m.id),
                    and_query.user_id?.range && {
                        gte: and_query.user_id.range.gte ? BigInt(and_query.user_id.range.gte) : undefined,
                        lte: and_query.user_id.range.lte ? BigInt(and_query.user_id.range.lte) : undefined,
                    },
                )
            )
                return false;
            if (!inRange(joined(m), and_query.guild_joined_at?.range)) return false;
            if (and_query.is_pending != null && !!m.pending !== and_query.is_pending) return false;
            if (and_query.source_invite_code?.or_query && !and_query.source_invite_code.or_query.includes(m.source_invite_code ?? "")) return false;
            if (and_query.join_source_type?.or_query && !and_query.join_source_type.or_query.map(Number).includes(m.join_source_type ?? 0)) return false;
            if (and_query.safety_signals && !signals(m, and_query.safety_signals).every(Boolean)) return false;
            return true;
        };

        const orMatch = (m: Member) => {
            const checks: boolean[] = [];
            if (or_query.usernames?.or_query) checks.push(or_query.usernames.or_query.some((q) => names(m).some((n) => n.startsWith(q.toLowerCase()))));
            if (or_query.user_id?.or_query) checks.push(or_query.user_id.or_query.includes(m.id));
            if (or_query.role_ids?.or_query) checks.push(or_query.role_ids.or_query.some((id) => m.roles.some((r) => r.id === id)));
            if (or_query.safety_signals) checks.push(...signals(m, or_query.safety_signals));
            return checks.length === 0 || checks.some(Boolean);
        };

        const sorters: Record<number, (a: Member, b: Member) => number> = {
            1: (a, b) => joined(b) - joined(a),
            2: (a, b) => joined(a) - joined(b),
            3: (a, b) => Snowflake.deconstruct(b.id).timestamp - Snowflake.deconstruct(a.id).timestamp,
            4: (a, b) => Snowflake.deconstruct(a.id).timestamp - Snowflake.deconstruct(b.id).timestamp,
        };
        const sorted = members.filter((m) => andMatch(m) && orMatch(m)).sort(sorters[sort] ?? sorters[1]);

        const cursorIndex = (cursor: Cursor) => sorted.findIndex((m) => m.id === cursor.user_id);
        let page = sorted;
        if (after?.user_id) page = sorted.slice(cursorIndex(after) + 1);
        else if (before?.user_id) page = sorted.slice(0, Math.max(0, cursorIndex(before)));
        page = before?.user_id && !after?.user_id ? page.slice(-Math.min(1000, limit)) : page.slice(0, Math.min(1000, limit));

        res.json({
            guild_id,
            members: page.map((m) => m.toSupplementalMember()),
            page_result_count: page.length,
            total_result_count: sorted.length,
        });
    },
);

export default router;
