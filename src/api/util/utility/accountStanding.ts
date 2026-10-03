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

import { User, UserViolation } from "@spacebar/database";
import { Config } from "@spacebar/util";
import { AccountStandingState, AppealIngestionType, AppealStatusValue, Classification, ClassificationType } from "@spacebar/schemas";

// a violation counts against the user until it expires, unless an appeal overturned it
export const isActiveViolation = (violation: UserViolation, now = new Date()) =>
    violation.expires_at > now && violation.appeal_status !== AppealStatusValue.CLASSIFICATION_INVALIDATED;

/**
 * The standing shown on the user's account standing page: the staff override when set, otherwise suspended for
 * disabled accounts, or one step down per active violation (1 limited, 2 very limited, 3+ at risk).
 */
export function automaticAccountStanding(user: Pick<User, "disabled">, violations: UserViolation[]): AccountStandingState {
    if (user.disabled) return AccountStandingState.SUSPENDED;
    const active = violations.filter((v) => isActiveViolation(v)).length;
    if (active === 0) return AccountStandingState.ALL_GOOD;
    if (active === 1) return AccountStandingState.LIMITED;
    if (active === 2) return AccountStandingState.VERY_LIMITED;
    return AccountStandingState.AT_RISK;
}

export const accountStanding = (user: Pick<User, "disabled" | "account_standing">, violations: UserViolation[]): AccountStandingState =>
    user.account_standing ?? automaticAccountStanding(user, violations);

export const getUserViolations = (user_id: string) => UserViolation.find({ where: { user_id }, order: { created_at: "DESC" } });

export const VIOLATION_TYPE_LABELS: Record<number, string> = {
    1: "Other",
    100: "Unsolicited adult content",
    200: "Non-consensual adult content",
    210: "Glorifying violence",
    220: "Hate speech",
    230: "Cracked accounts",
    240: "Illicit goods",
    250: "Social engineering",
    280: "Child safety",
    290: "Harassment and bullying",
    310: "Harassment and bullying",
    320: "Hateful conduct",
    390: "Harassment and bullying",
    711: "Impersonation",
    720: "Ban evasion",
    3010: "Malicious conduct",
    3030: "Spam",
    4000: "Non-consensual adult content",
    4010: "Fraud",
    5090: "Self-harm",
    5305: "Doxxing",
    5411: "Underage user",
    5440: "Copyright infringement",
};

// the shape discord's client renders on the account standing page
export function toClassification(violation: UserViolation): Classification {
    return {
        id: violation.id,
        classification_type: violation.classification_type,
        // the client puts this after "You broke the rules for", so it's the rule; the staff's own words go in staff_message,
        // which the patched client shows under that heading in the violation's popup
        description: VIOLATION_TYPE_LABELS[violation.classification_type] ?? VIOLATION_TYPE_LABELS[1],
        staff_message: violation.description,
        explainer_link: Config.get().general.tosPage ?? "",
        actions: violation.actions.map((action, i) => ({ id: `${violation.id}${i}`, action_type: action.action_type, descriptions: action.descriptions })),
        max_expiration_time: violation.expires_at.toISOString(),
        flagged_content: violation.flagged_content ?? [],
        // null tells the client the user can still appeal
        appeal_status: violation.appeal_status ? { status: violation.appeal_status } : null,
        is_coppa: false,
        is_spam: violation.classification_type === ClassificationType.SPAM,
        appeal_ingestion_type: AppealIngestionType.IN_APP,
    };
}
