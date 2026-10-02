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

interface DetectableGame {
    id: string;
    name: string;
    [key: string]: unknown;
}

let cache: { games: DetectableGame[]; byId: Map<string, DetectableGame>; expires: number } | undefined;
let pending: Promise<DetectableGame[]> | undefined;

export async function getDetectableGames(): Promise<DetectableGame[]> {
    if (cache && cache.expires > Date.now()) return cache.games;
    pending ??= (async () => {
        try {
            const response = await fetch("https://discord.com/api/v10/games/detectable", { signal: AbortSignal.timeout(15000) });
            if (!response.ok) return cache?.games ?? [];
            const games = (await response.json()) as DetectableGame[];
            cache = { games, byId: new Map(games.map((game) => [game.id, game])), expires: Date.now() + 6 * 60 * 60 * 1000 };
            return games;
        } catch {
            return cache?.games ?? [];
        } finally {
            pending = undefined;
        }
    })();
    return pending;
}

export async function getDetectableGamesById(ids: string[]) {
    await getDetectableGames();
    return ids.map((id) => cache?.byId.get(id)).filter((game): game is DetectableGame => !!game);
}
