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

import { PrivateCalls, Session, StageInstances, Stream, VoiceState } from "@spacebar/database";
import { broadcastPresence, emitSessionsReplace, Event, PRESENCE_STALE_AFTER_MS, RabbitMQ } from "@spacebar/util";
import { WebSocket } from "./WebSocket";
import { OPCODES } from "./Constants";
import { Send } from "./Send";

export function parseStreamKey(streamKey: string): {
    type: "guild" | "call";
    channelId: string;
    guildId?: string;
    userId: string;
} {
    const streamKeyArray = streamKey.split(":");

    const type = streamKeyArray.shift();

    if (type !== "guild" && type !== "call") {
        throw new Error(`Invalid stream key type: ${type}`);
    }

    if ((type === "guild" && streamKeyArray.length < 3) || (type === "call" && streamKeyArray.length < 2)) throw new Error(`Invalid stream key: ${streamKey}`); // invalid stream key

    let guildId: string | undefined;
    if (type === "guild") {
        guildId = streamKeyArray.shift();
    }
    const channelId = streamKeyArray.shift();
    const userId = streamKeyArray.shift();

    if (!channelId || !userId) {
        throw new Error(`Invalid stream key: ${streamKey}`);
    }
    return { type, channelId, guildId, userId };
}

export function generateStreamKey(type: "guild" | "call", guildId: string | undefined, channelId: string, userId: string): string {
    const streamKey = `${type}${type === "guild" ? `:${guildId}` : ""}:${channelId}:${userId}`;

    return streamKey;
}

let callStateCleanup: Promise<void> | undefined;

/**
 * Clears the voice states, Go Live streams, stage instances and open calls left by the last run. It runs once per process
 * and has to finish before any client connects: clients reconnect within seconds of a restart and set up their voice
 * states and streams again, and a wipe landing after that leaves people missing from calls and screenshares black.
 */
export function clearCallStateOnStartup() {
    callStateCleanup ??= (async () => {
        console.log("[Gateway] Clearing voice states, streams and calls left from the last run...");
        await Promise.all([VoiceState.clear(), Stream.createQueryBuilder().delete().execute(), StageInstances.clear(), PrivateCalls.endStaleCalls()]).then(
            () => console.log("[Gateway] Cleared voice states, streams and calls"),
            (e) => console.error("[Gateway] Error clearing voice states, streams and calls on startup:", e),
        );
    })();
    return callStateCleanup;
}

// Temporary cleanup function until shutdown cleanup function is fixed.
// Currently when server is shut down the voice states are not cleared
// TODO: remove this when Server.stop() is fixed so that it waits for all websocket connections to run their
// respective Close event listener function for session cleanup
export async function cleanupOnStartup(): Promise<void> {
    // TODO: how is this different from clearing the table?
    //await VoiceState.update(
    //	{},
    //	{
    //		// @ts-expect-error channel_id is nullable
    //		channel_id: null,
    //		// @ts-expect-error guild_id is nullable
    //		guild_id: null,
    //		self_stream: false,
    //		self_video: false,
    //	},
    //);

    await clearCallStateOnStartup();

    const singleProcess = !process.env.EVENT_TRANSMISSION && !RabbitMQ.connection;
    console.log("[Gateway] Starting async presence expiry...");
    expirePresences(singleProcess)
        .then((count) => console.log(`[Gateway] Marked ${count} leftover sessions offline`))
        .catch((e) => console.error("[Gateway] Error cleaning expired presence states on startup:", e));
}

export async function expirePresences(all = false) {
    const query = Session.createQueryBuilder().update().set({ status: "offline", activities: [], client_status: {} }).where("status != 'offline'");
    if (!all) query.andWhere("(last_seen IS NULL OR last_seen < :since)", { since: new Date(Date.now() - PRESENCE_STALE_AFTER_MS) });
    const { raw } = await query.returning(["user_id"]).execute();
    const userIds = [...new Set((raw as { user_id: string }[]).map((x) => String(x.user_id)))];
    if (all) return userIds.length;
    for (const userId of userIds) {
        await emitSessionsReplace(userId).catch((e) => console.error(`[Gateway] failed to replace sessions for ${userId}`, e));
        await broadcastPresence(userId).catch((e) => console.error(`[Gateway] failed to broadcast presence for ${userId}`, e));
    }
    return userIds.length;
}

let presenceSweep: NodeJS.Timeout | undefined;
export function startPresenceSweep() {
    if (presenceSweep) return;
    let running = false;
    presenceSweep = setInterval(() => {
        if (running) return;
        running = true;
        expirePresences()
            .catch((e) => console.error("[Gateway] presence sweep failed", e))
            .finally(() => (running = false));
    }, 15_000);
    presenceSweep.unref();
}

export function stopPresenceSweep() {
    clearInterval(presenceSweep);
    presenceSweep = undefined;
}

export async function handleOffloadedGatewayRequest(socket: WebSocket, url: string, body: unknown): Promise<boolean> {
    try {
        // TODO: async json object streaming
        const resp = await fetch(url, {
            body: JSON.stringify(body),
            method: "POST",
            headers: {
                Authorization: `Bearer ${socket.accessToken}`,
                // because the session may not have an id in the token!
                "X-Session-Id": socket.session_id,
                "Content-Type": "application/json",
            },
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error(`[Gateway] Offloaded request to ${url} failed with status ${resp.status}: ${text}`);
            if (resp.status === 415 || resp.status === 400) console.log(typeof body, body);
            // throw new Error(`Offloaded request failed with status ${resp.status}: ${text}`);
            return false;
        }

        const data = ((await resp.json()) as Event[]).toReversed();
        while (data.length > 0) {
            const event = data.pop()!;
            if (process.env.WS_VERBOSE) console.log(`[Gateway] Received offloaded event: ${JSON.stringify(event)}`);
            await Send(socket, {
                op: OPCODES.Dispatch,
                s: socket.sequence++,
                t: event.event,
                d: event.data,
            });
        }

        return true;
    } catch (e) {
        console.error("Error while handling offloaded gateway request:", e);
        return false;
    }
}
