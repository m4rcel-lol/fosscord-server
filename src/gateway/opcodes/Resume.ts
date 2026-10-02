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
import { holdForResume, OPCODES, Payload, resumableSockets, Send, WebSocket } from "@spacebar/gateway";
import { broadcastPresence, checkToken } from "@spacebar/util";
import { CLOSECODES } from "../util/Constants";

export async function onResume(this: WebSocket, { d }: Payload) {
    if (this.user_id) return this.close(CLOSECODES.Already_authenticated);
    const { token, session_id, seq } = (d ?? {}) as { token?: string; session_id?: string; seq?: number };
    const previous = session_id ? resumableSockets.get(session_id) : undefined;
    const invalidate = () => Send(this, { op: OPCODES.Invalid_Session, d: false });

    if (!token || !previous || previous.resumedBy || !previous.resumeBuffer) return invalidate();
    const tokenData = await checkToken(token).catch(() => undefined);
    if (tokenData?.user?.id !== previous.user_id || resumableSockets.get(session_id!) !== previous) return invalidate();

    resumableSockets.delete(session_id!);
    clearTimeout(this.readyTimeout);
    clearTimeout(previous.resumeTimer);

    this.user_id = previous.user_id;
    this.session_id = previous.session_id;
    this.session = previous.session;
    this.accessToken = token;
    this.capabilities = previous.capabilities;
    this.intents = previous.intents;
    this.large_threshold = previous.large_threshold;
    this.shard_id = previous.shard_id;
    this.shard_count = previous.shard_count;
    this.events = previous.events;
    this.member_events = previous.member_events;
    this.permissions = previous.permissions;
    this.member_lists = previous.member_lists;
    this.listen_options = previous.listen_options;
    this.listenerCleanup = previous.listenerCleanup;
    this.recentTransactions = previous.recentTransactions;
    this.sequence = previous.sequence;

    const seen = new Set<number>();
    const missed = [...(previous.replayBuffer ?? []), ...previous.resumeBuffer].filter((x) => {
        if ((x.s ?? -1) <= (seq ?? -1) || seen.has(x.s!)) return false;
        seen.add(x.s!);
        return true;
    });
    previous.resumeBuffer = undefined;
    previous.replayBuffer = undefined;
    previous.resumedBy = this;

    this.once("close", () => holdForResume(this, this.listenerCleanup!));

    for (const payload of missed) await Send(this, payload);
    await Send(this, { op: OPCODES.Dispatch, t: "RESUMED", s: this.sequence++, d: {} });

    const stored = await Session.findOne({ where: { session_id: this.session_id }, select: { session_id: true, status: true } });
    if (this.session) {
        this.session.last_seen = new Date();
        await Session.update(
            { session_id: this.session_id },
            { last_seen: this.session.last_seen, status: this.session.status, activities: this.session.activities, client_status: this.session.client_status },
        );
        if (stored?.status === "offline" && this.session.status !== "offline") await broadcastPresence(this.user_id);
    }
    console.log(`[Gateway/${this.user_id}] RESUMED ${this.session_id} replaying ${missed.length} events from seq ${seq}`);
}
