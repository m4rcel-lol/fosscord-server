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
        privacyPage?: string | null;
        guidelinesPage?: string | null;
        correspondenceEmail?: string | null;
        correspondenceUserID?: string | null;
    };
    client?: {
        /**
         * @maxLength 100
         */
        instanceName?: string;
        icon?: string | null;
        logo?: string | null;
        helpUrl?: string | null;
        activityApplicationHost?: string | null;
    };
    register?: {
        disabled?: boolean;
        allowNewRegistration?: boolean;
        requireInvite?: boolean;
        guestsRequireInvite?: boolean;
        requireCaptcha?: boolean;
        allowMultipleAccounts?: boolean;
        incrementingDiscriminators?: boolean;
        email?: { required?: boolean };
        dateOfBirth?: {
            /**
             * @minimum 0
             * @maximum 100
             */
            minimum?: number;
        };
        password?: {
            /**
             * @minimum 1
             * @maximum 72
             */
            minLength?: number;
            /**
             * @minimum 0
             */
            minNumbers?: number;
            /**
             * @minimum 0
             */
            minUpperCase?: number;
            /**
             * @minimum 0
             */
            minSymbols?: number;
        };
    };
    login?: { requireCaptcha?: boolean };
    passwordReset?: { requireCaptcha?: boolean };
    captcha?: {
        enabled?: boolean;
        service?: "cap" | "hcaptcha" | "recaptcha" | null;
        sitekey?: string | null;
        /**
         * Write only. An empty string keeps the current secret.
         */
        secret?: string | null;
        /**
         * Base URL of a Cap Standalone server
         */
        instance?: string | null;
    };
    rate?: {
        enabled?: boolean;
        ip?: AdminRateLimitSchema;
        global?: AdminRateLimitSchema;
        error?: AdminRateLimitSchema;
        login?: AdminRateLimitSchema;
        register?: AdminRateLimitSchema;
    };
    e2ee?: {
        /**
         * @minimum 1024
         */
        maxEnvelopeBytes?: number;
        /**
         * @minimum 1
         */
        maxEnvelopeDevices?: number;
        /**
         * @minimum 1
         */
        pendingDeviceTtlHours?: number;
        /**
         * @minimum 1
         */
        deviceRegistrationsPerHour?: number;
        /**
         * @minimum 1
         */
        deviceUpdatesPerHour?: number;
        /**
         * @minimum 1
         */
        keyQueriesPerMinute?: number;
    };
}

export interface AdminRateLimitSchema {
    /**
     * @minimum 1
     */
    count: number;
    /**
     * Seconds
     * @minimum 1
     */
    window: number;
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
     * The tag shown next to the user's name. BOT tags only render for bot accounts; AI, OFFICIAL and SYSTEM tags render for anyone.
     */
    tag?: AdminUserTag;
    /**
     * Instance badges shown on the user's profile, in display order
     */
    badge_ids?: string[];
    /**
     * Overrides the standing shown on the user's account standing page (AccountStandingState: 100 all good, 200 limited,
     * 300 very limited, 400 at risk, 500 suspended); null works it out from their active violations
     */
    account_standing?: 100 | 200 | 300 | 400 | 500 | null;
}

export interface AdminViolationActionSchema {
    /**
     * ClassificationActionType
     * @minimum 0
     */
    action_type: number;
    descriptions?: string[];
}

export interface AdminViolationCreateSchema {
    /**
     * ClassificationType, what the user broke (spam, harassment, ...)
     * @minimum 1
     */
    classification_type: number;
    /**
     * Shown to the user on their account standing page
     * @minLength 1
     * @maxLength 2000
     */
    description: string;
    actions?: AdminViolationActionSchema[];
    /**
     * How long it counts against the user; omit or null for permanent
     * @minimum 1
     */
    expires_in_days?: number | null;
}

export interface AdminViolationUpdateSchema {
    /**
     * Resolve an appeal: 2 upheld, 3 overturned (stops counting against the user); null clears the appeal
     */
    appeal_status?: 2 | 3 | null;
    /**
     * New expiry as an ISO timestamp
     */
    expires_at?: string;
}

export type AdminUserTag = "none" | "verified_bot" | "ai" | "verified_ai" | "official" | "system";

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
    /**
     * The server tag. Unlike the regular guild profile route there's no length or character limit here; null removes it
     */
    tag?: string | null;
    /**
     * Server tag badge type
     * @minimum 0
     * @maximum 40
     */
    badge?: number;
    /**
     * Badge colours as #rrggbb; null uses the badge's own colours
     * @pattern ^#[0-9a-fA-F]{6}$
     */
    badge_color_primary?: string | null;
    /**
     * @pattern ^#[0-9a-fA-F]{6}$
     */
    badge_color_secondary?: string | null;
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

export interface AdminAnnouncementCreateSchema {
    /**
     * Markdown, sent as the message's text
     * @minLength 1
     * @maxLength 4000
     */
    body: string;
    /**
     * everyone: every user on the instance; staff: only people with admin panel access
     */
    audience: "everyone" | "staff";
}

export interface AdminReportUpdateSchema {
    status?: "open" | "resolved" | "dismissed";
    /**
     * @maxLength 2000
     */
    resolution_note?: string | null;
    /**
     * Also delete the reported message. Needs the MANAGE_MESSAGES right.
     */
    delete_message?: boolean;
}

export interface AdminPasswordResetSchema {
    /**
     * Also email the link, when the user has an email address and the instance can send email
     */
    send_email?: boolean;
    /**
     * Sign the user out of every session
     */
    revoke_sessions?: boolean;
}

export interface AdminSessionsRevokeSchema {
    /**
     * The sessions to end; omit to end all of them
     */
    session_ids?: string[];
}
