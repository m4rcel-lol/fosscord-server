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

import { Badge, User } from "@spacebar/database";
import { Config, Rights } from "@spacebar/util";

// rights that open at least one area of the admin dashboard
export const ADMIN_PANEL_RIGHTS = ["OPERATOR", "MANAGE_USERS", "MANAGE_GUILDS"] as const;

// fixed so the badge can be found again; snowflakes never get this low. Its text and icon stay editable
export const STAFF_BADGE_ID = "1";
const STAFF_BADGE_ICON = "5e74e9b61934fc1f67c65515d1f7e60d"; // discord's staff badge

export const hasAdminPanelAccess = (rights: string | bigint | number | null | undefined) => new Rights(BigInt(rights ?? 0)).any([...ADMIN_PANEL_RIGHTS]);

export async function ensureStaffBadge() {
    const existing = await Badge.findOne({ where: { id: STAFF_BADGE_ID } });
    if (existing) return existing;
    return Badge.create({ id: STAFF_BADGE_ID, description: `${Config.get().general.instanceName} Staff`, icon: STAFF_BADGE_ICON }).save();
}

// gaining admin access hands out the staff badge, losing all of it takes the badge away
export async function syncStaffBadge(user: User, hadAccess: boolean) {
    const hasAccess = hasAdminPanelAccess(user.rights);
    const badges = user.badge_ids ?? [];
    if (hasAccess && !hadAccess && !badges.includes(STAFF_BADGE_ID)) {
        await ensureStaffBadge();
        user.badge_ids = [STAFF_BADGE_ID, ...badges];
    } else if (!hasAccess && hadAccess) user.badge_ids = badges.filter((id) => id !== STAFF_BADGE_ID);
}
