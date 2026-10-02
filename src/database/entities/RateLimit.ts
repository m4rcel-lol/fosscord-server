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

import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";

@Entity({
    name: "rate_limits",
})
export class RateLimit extends BaseClassWithoutId {
    @PrimaryColumn({ type: "varchar" })
    id: string;

    @Column()
    executor_id: string;

    @Column()
    hits: number;

    @Column()
    blocked: boolean;

    @Index("IDX_rate_limits_expires_at")
    @Column()
    expires_at: Date;

    static async hit(id: string, executor_id: string, max_hits: number, window: number) {
        const now = new Date();
        const [row] = (await RateLimit.query(
            `INSERT INTO rate_limits (id, executor_id, hits, blocked, expires_at) VALUES ($1, $2, 1, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
                 hits = CASE WHEN rate_limits.expires_at <= $5 THEN 1 ELSE rate_limits.hits + 1 END,
                 expires_at = CASE WHEN rate_limits.expires_at <= $5 THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END,
                 blocked = (CASE WHEN rate_limits.expires_at <= $5 THEN 1 ELSE rate_limits.hits + 1 END) >= $6
             RETURNING hits, blocked, expires_at`,
            [id, executor_id, max_hits <= 1, new Date(now.getTime() + window * 1000), now, max_hits],
        )) as { hits: number; blocked: boolean; expires_at: Date }[];
        return { id, executor_id, hits: row.hits, blocked: row.blocked, expires_at: new Date(row.expires_at) };
    }
}
