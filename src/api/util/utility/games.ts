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

import fs from "node:fs/promises";
import path from "node:path";
import { ASSETS_FOLDER } from "@spacebar/util";
import { CustomGame } from "@spacebar/database";

export interface DetectableGame {
    id: string;
    name: string;
    aliases?: string[];
    executables?: unknown[];
    icon_hash?: string | null;
    cover_image_hash?: string | null;
    themes?: string[];
    third_party_skus?: unknown[];
    overlay?: boolean;
    overlay_warn?: boolean;
    overlay_compatibility_hook?: boolean;
    overlay_methods?: number;
    hook?: boolean;
    content_classification?: unknown;
    [key: string]: unknown;
}

const SOURCE = "https://discord.com/api/v10/games/detectable";
const CACHE_FILE = path.join(ASSETS_FOLDER, "detectable.json");
const TTL = 6 * 3_600_000;
const SUGGESTED = ["Minecraft", "Fortnite", "League of Legends", "VALORANT", "Roblox", "Counter-Strike 2", "Genshin Impact", "Overwatch 2", "Apex Legends", "Grand Theft Auto V"];

type GameIndex = { games: DetectableGame[]; byId: Map<string, DetectableGame>; expires: number };

let loaded: GameIndex | undefined;
let pending: Promise<GameIndex> | undefined;
// games the admins added, kept until one of them changes; listed before discord's
let custom: DetectableGame[] | undefined;
let merged: { remote: GameIndex; custom: DetectableGame[]; index: GameIndex } | undefined;

const index = (games: DetectableGame[], expires: number) => ({ games, byId: new Map(games.map((x) => [x.id, x])), expires });

export const cleanGameAliases = (aliases: string[] | undefined) => [...new Set((aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];

export const serializeCustomGame = (game: CustomGame) => ({
    id: game.id,
    name: game.name,
    aliases: game.aliases ?? [],
    icon_hash: game.icon_hash ?? null,
    cover_image_hash: game.cover_image_hash ?? null,
    created_at: game.created_at,
});

export const customGameToDetectable = (game: CustomGame): DetectableGame => ({
    id: game.id,
    name: game.name,
    aliases: game.aliases ?? [],
    executables: [],
    icon_hash: game.icon_hash ?? null,
    cover_image_hash: game.cover_image_hash ?? null,
    themes: [],
    third_party_skus: [],
    overlay: false,
    hook: false,
});

async function fetchList() {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(20000) }).catch(() => undefined);
    if (!res?.ok) return undefined;
    const text = await res.text();
    const games = JSON.parse(text) as DetectableGame[];
    if (!Array.isArray(games)) return undefined;
    await fs.writeFile(CACHE_FILE, text).catch(() => undefined);
    return games;
}

export const DetectableGames = {
    async load() {
        const remote = await this.loadRemote();
        custom ??= (await CustomGame.find({ order: { name: "ASC" } })).map(customGameToDetectable);
        if (merged?.remote !== remote || merged.custom !== custom) merged = { remote, custom, index: index([...custom, ...remote.games], remote.expires) };
        return merged.index;
    },

    /** Call after adding, changing or removing a custom game. */
    invalidateCustom() {
        custom = undefined;
    },

    async loadRemote() {
        if (loaded && loaded.expires > Date.now()) return loaded;
        pending ??= (async () => {
            const stat = await fs.stat(CACHE_FILE).catch(() => undefined);
            const fresh = stat && Date.now() - stat.mtimeMs < TTL;
            const games = (!fresh && (await fetchList().catch(() => undefined))) || (stat ? (JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as DetectableGame[]) : []);
            loaded = index(games, Date.now() + (games.length ? TTL : 60_000));
            return loaded;
        })().finally(() => (pending = undefined));
        return pending;
    },

    async search(query: string, limit = 10) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const { games } = await this.load();
        const scored: { game: DetectableGame; score: number }[] = [];
        for (const game of games) {
            const names = [game.name, ...(game.aliases ?? [])].map((x) => x.toLowerCase());
            const score = names.some((x) => x === q) ? 0 : names.some((x) => x.startsWith(q)) ? 1 : names.some((x) => x.includes(q)) ? 2 : -1;
            if (score >= 0) scored.push({ game, score });
        }
        return scored
            .sort((a, b) => a.score - b.score || a.game.name.length - b.game.name.length)
            .slice(0, limit)
            .map((x) => x.game);
    },

    async suggested() {
        const { games } = await this.load();
        return SUGGESTED.map((name) => games.find((x) => x.name === name)?.id).filter((x): x is string => !!x);
    },

    toGame(game: DetectableGame) {
        return {
            id: game.id,
            name: game.name,
            description: "",
            aliases: game.aliases ?? [],
            executables: game.executables ?? [],
            overlay: game.overlay ?? false,
            overlay_warn: game.overlay_warn ?? false,
            overlay_compatibility_hook: game.overlay_compatibility_hook ?? false,
            overlay_methods: game.overlay_methods ?? 0,
            hook: game.hook ?? true,
            third_party_skus: game.third_party_skus ?? [],
            themes: game.themes ?? [],
            genres: [],
            platforms: [],
            platform_availability: [],
            websites: [],
            companies: [],
            media: {
                icon: game.icon_hash ? { type: "hash", value: game.icon_hash } : undefined,
                cover: game.cover_image_hash ? { type: "hash", value: game.cover_image_hash } : undefined,
            },
            game_flags: 0,
            content_classification: game.content_classification,
        };
    },
};
