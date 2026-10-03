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

import murmur from "murmurhash-js/murmurhash3_gc";
import { Config } from "./Config";

export const SCHEDULED_MESSAGE_LIMIT = 25;
export const SAVED_MESSAGE_LIMIT = 500;
export const MESSAGE_REMINDER_LIMIT = 100;

const defaults: Record<string, { variant: number; config?: object }> = {
    "2026-08-scheduled-messages": { variant: 1, config: { limit: SCHEDULED_MESSAGE_LIMIT } },
    "2026-03-message-bookmarks": { variant: 1 },
    "2026-07-message-bookmarks-v2": { variant: 1, config: { b: SAVED_MESSAGE_LIMIT, r: MESSAGE_REMINDER_LIMIT } },
    "2026-08-mark-channel-unread": { variant: 1 },
    "2026-03-soundmoji-rendering": { variant: 1 },
    "2026-03-soundmoji-sending": { variant: 2 },
    "2026-09-soundboard-favorites": { variant: 1 },
};

export type ApexAssignment = [number, number, number, number, number, string | undefined];

export function getApexExperiments(userId?: string) {
    if (!userId) return { assignments: {} };
    const overrides = Config.get().client.experiments ?? {};
    const assignments: ApexAssignment[] = [];
    for (const name of new Set([...Object.keys(defaults), ...Object.keys(overrides)])) {
        const variant = Number(overrides[name] ?? defaults[name]?.variant);
        if (!Number.isInteger(variant) || variant <= 0) continue;
        const config = defaults[name]?.config;
        assignments.push([murmur(name), variant, 0, 1, variant, config ? JSON.stringify(config) : undefined]);
    }
    return { assignments: { 1: { [userId]: { evaluation_id: null, assignments } } } };
}
