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

import { getDatabase } from "@spacebar/database";

const BATCH = 500;
let running: Promise<void> | null = null;
let again = false;

async function drain() {
    const db = getDatabase()!;
    for (;;) {
        const [next] = (await db.query(`SELECT "channel_id" FROM "message_purges" ORDER BY "created_at" LIMIT 1`)) as { channel_id: string }[];
        if (!next) return;
        let deleted: number;
        do {
            const [, count] = (await db.query(`DELETE FROM "messages" WHERE "id" IN (SELECT "id" FROM "messages" WHERE "channel_id" = $1 LIMIT ${BATCH})`, [next.channel_id])) as [
                unknown,
                number,
            ];
            deleted = count;
            await new Promise<void>((resolve) => void setImmediate(resolve));
        } while (deleted >= BATCH);
        await db.query(`DELETE FROM "message_purges" WHERE "channel_id" = $1`, [next.channel_id]);
    }
}

export function purgeDeletedChannels() {
    if (running) {
        again = true;
        return running;
    }
    running = (async () => {
        do {
            again = false;
            await drain();
        } while (again);
    })()
        .catch((e) => console.error("[MessagePurge] failed to purge messages of deleted channels", e))
        .finally(() => {
            running = null;
        });
    return running;
}

export function startMessagePurger() {
    setTimeout(purgeDeletedChannels, 5_000);
    return setInterval(purgeDeletedChannels, 60_000);
}
