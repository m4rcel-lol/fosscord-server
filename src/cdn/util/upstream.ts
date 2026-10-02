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

import { storage } from "./Storage";

const inflight = new Map<string, Promise<Buffer | null>>();

export function fetchUpstreamAsset(path: string, url: string): Promise<Buffer | null> {
    const pending = inflight.get(path);
    if (pending) return pending;
    const task = (async () => {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            await storage.set(path, buffer);
            return buffer;
        } catch {
            return null;
        } finally {
            inflight.delete(path);
        }
    })();
    inflight.set(path, task);
    return task;
}
