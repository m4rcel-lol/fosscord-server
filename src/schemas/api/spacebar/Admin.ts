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

export interface AdminSettingsUpdateSchema {
    general?: {
        instanceName?: string;
        instanceDescription?: string | null;
        image?: string | null;
        frontPage?: string | null;
        tosPage?: string | null;
        correspondenceEmail?: string | null;
        correspondenceUserID?: string | null;
    };
    register?: {
        disabled?: boolean;
        allowNewRegistration?: boolean;
        requireInvite?: boolean;
        requireCaptcha?: boolean;
        allowMultipleAccounts?: boolean;
    };
}

export interface AdminUserUpdateSchema {
    /**
     * @maxLength 32
     */
    global_name?: string | null;
    bio?: string;
    disabled?: boolean;
    verified?: boolean;
    /**
     * @minimum 0
     * @maximum 3
     */
    premium_type?: number;
    /**
     * Leave the premium badge off their profile without touching their premium itself
     */
    hide_premium_badge?: boolean;
    /**
     * Bitfield of instance rights, as a decimal string. Requires OPERATOR to change.
     */
    rights?: string;
    /**
     * The tag shown next to the user's name. BOT tags only render for bot accounts; AI tags render for anyone.
     */
    tag?: AdminUserTag;
    /**
     * Instance badges shown on the user's profile, in display order
     */
    badge_ids?: string[];
}

export type AdminUserTag = "none" | "verified_bot" | "ai" | "verified_ai";

export interface AdminBadgeCreateSchema {
    /**
     * Tooltip text shown when hovering the badge
     * @minLength 1
     * @maxLength 120
     */
    description: string;
    /**
     * An existing icon hash (served from /badge-icons/<icon>.png; unknown hashes fall back to discord's CDN)
     */
    icon?: string;
    /**
     * A data: URI image to upload as the icon instead
     */
    icon_data?: string;
    link?: string | null;
}

export interface AdminBadgeUpdateSchema {
    /**
     * @minLength 1
     * @maxLength 120
     */
    description?: string;
    icon?: string;
    icon_data?: string;
    link?: string | null;
}

export interface AdminGuildUpdateSchema {
    /**
     * @minLength 2
     * @maxLength 100
     */
    name?: string;
    description?: string | null;
    features?: string[];
    owner_id?: string;
}

export type AdminStatusComponentState = "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";

export interface AdminStatusComponentSchema {
    /**
     * @minLength 1
     * @maxLength 100
     */
    name: string;
    description?: string | null;
    status?: AdminStatusComponentState;
    position?: number;
}

export interface AdminStatusComponentUpdateSchema {
    /**
     * @minLength 1
     * @maxLength 100
     */
    name?: string;
    description?: string | null;
    status?: AdminStatusComponentState;
    position?: number;
}

export type AdminStatusIncidentImpact = "none" | "minor" | "major" | "critical" | "maintenance";
export type AdminStatusIncidentState = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled" | "in_progress" | "verifying" | "completed";

export interface AdminStatusIncidentCreateSchema {
    /**
     * @minLength 1
     * @maxLength 200
     */
    name: string;
    impact: AdminStatusIncidentImpact;
    status: AdminStatusIncidentState;
    /**
     * @minLength 1
     */
    body: string;
    component_ids?: string[];
    /**
     * Status to set the affected components to while the incident is open
     */
    component_status?: AdminStatusComponentState;
    scheduled_for?: string | null;
    scheduled_until?: string | null;
}

export interface AdminStatusIncidentUpdateSchema {
    name?: string;
    impact?: AdminStatusIncidentImpact;
    component_ids?: string[];
    scheduled_for?: string | null;
    scheduled_until?: string | null;
}

export interface AdminStatusIncidentPostUpdateSchema {
    status: AdminStatusIncidentState;
    /**
     * @minLength 1
     */
    body: string;
}
