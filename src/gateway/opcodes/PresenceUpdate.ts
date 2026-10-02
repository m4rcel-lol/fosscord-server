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

import { Session } from "@spacebar/database";
import { WebSocket, Payload } from "@spacebar/gateway";
import { broadcastPresence, sanitizeActivities } from "@spacebar/util";
import { ActivitySchema, PrivateStatus } from "@spacebar/schemas";
import { check } from "./instanceOf";

const SettableStatuses = ["online", "idle", "dnd", "invisible"];
const PresenceWindow = 20_000;
const PresenceLimit = 5;

export async function onPresenceUpdate(this: WebSocket, { d }: Payload) {
    check.call(this, ActivitySchema, d);
    const presence = d as ActivitySchema;
    if (!this.session) return;

    const previous = JSON.stringify([this.session.status, this.session.activities, this.session.client_status]);

    if (SettableStatuses.includes(presence.status)) this.session.status = presence.status as PrivateStatus;
    this.session.activities = sanitizeActivities(presence.activities, this.session.activities);
    const platform = this.session.client_info?.platform ?? "web";
    this.session.client_status = this.session.status === "invisible" ? {} : { [platform]: this.session.status };
    this.session.last_seen = new Date();

    if (previous === JSON.stringify([this.session.status, this.session.activities, this.session.client_status])) return;

    const now = Date.now();
    this.presenceHistory = (this.presenceHistory ?? []).filter((time) => now - time < PresenceWindow);
    if (this.presenceHistory.length >= PresenceLimit) {
        this.presenceTimer ??= setTimeout(
            () => {
                this.presenceTimer = undefined;
                if (this.readyState !== this.OPEN) return;
                this.presenceHistory = [...(this.presenceHistory ?? []), Date.now()];
                savePresence.call(this).catch((e) => console.error(`[Gateway/${this.user_id}] failed to save throttled presence`, e));
            },
            PresenceWindow - (now - this.presenceHistory[0]),
        );
        return;
    }
    this.presenceHistory.push(now);
    await savePresence.call(this);
}

async function savePresence(this: WebSocket) {
    if (!this.session) return;
    await Session.update(
        { session_id: this.session_id },
        { status: this.session.status, activities: this.session.activities, client_status: this.session.client_status, last_seen: this.session.last_seen },
    );
    await broadcastPresence(this.user_id);
}
