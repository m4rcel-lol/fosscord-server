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

import fs from "node:fs";
import path from "node:path";
import { ASSETS_FOLDER } from "@spacebar/util";

// Server tag badges, rendered from templates scripts/clan-badges.js extracts from the downloaded web client.
// A shaded colour is stored as { ch, c0, c1, def }: the guild's primary (P) or secondary (S) colour moved to
// luminance c0 + c1 * luminance(colour), the way the client tints them, or `def` when that colour isn't set.

type Shade = { ch: "P" | "S"; c0: number; c1: number; def: string };
type BadgeNode = string | { t: string; a: Record<string, string | number | Shade>; c: BadgeNode[] };
type Templates = Record<string, { name: string; svg: BadgeNode }>;

const TEMPLATE_PATH = path.join(ASSETS_FOLDER, "cache", "clan-badges.json");
let templates: Templates | null = null;
let loadedFrom = 0;

// reread when `npm run generate:client` regenerates the file, without needing a restart
function loadTemplates(): Templates | null {
    const mtime = fs.statSync(TEMPLATE_PATH, { throwIfNoEntry: false })?.mtimeMs;
    if (!mtime) return null;
    if (mtime !== loadedFrom) {
        try {
            templates = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")).badges;
            loadedFrom = mtime;
        } catch (e) {
            console.error("[CDN] couldn't read clan badge templates", e);
            return null;
        }
    }
    return templates;
}

type Rgb = [number, number, number];

const parseHex = (value: string): Rgb | null => {
    const hex = value.replace(/^#/, "");
    const full = hex.length === 3 || hex.length === 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
    return /^[0-9a-f]{6}$/i.test(full) ? ([0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb) : null;
};

// same maths as chroma-js, which the client uses: relative luminance, and luminance(x) bisecting in rgb
// towards black or white until it's within 1e-7 (or 20 steps)
const channel = (x: number) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function withLuminance(rgb: Rgb, target: number): Rgb {
    if (target <= 0) return [0, 0, 0];
    if (target >= 1) return [255, 255, 255];
    let iterations = 20;
    const test = (low: Rgb, high: Rgb): Rgb => {
        const mid = low.map((v, i) => v + (high[i] - v) * 0.5) as Rgb;
        const lum = luminance(mid);
        if (Math.abs(target - lum) < 1e-7 || !iterations--) return mid;
        return lum > target ? test(low, mid) : test(mid, high);
    };
    return luminance(rgb) > target ? test([0, 0, 0], rgb) : test(rgb, [255, 255, 255]);
}

const toHex = (rgb: Rgb) =>
    `#${rgb
        .map((v) =>
            Math.round(Math.min(255, Math.max(0, v)))
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;

const ATTRIBUTE_NAMES: Record<string, string> = { clipPath: "clip-path", clipRule: "clip-rule", fillRule: "fill-rule", stopColor: "stop-color" };
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// [{ id, name }] for every badge with a template, empty when the client cache hasn't been generated
export function listClanBadges() {
    return Object.entries(loadTemplates() ?? {})
        .map(([id, { name }]) => ({ id: Number(id), name }))
        .sort((a, b) => a.id - b.id);
}

/**
 * Draws a server tag badge as standalone SVG, or returns null when the templates aren't there (the client
 * cache hasn't been generated) or the badge type is unknown.
 */
export function renderClanBadge(badge: number | string | null | undefined, primary: string | null | undefined, secondary: string | null | undefined, size = 64): string | null {
    const template = loadTemplates()?.[String(badge ?? 0)];
    if (!template) return null;

    const tints = { P: primary ? parseHex(primary) : null, S: secondary ? parseHex(secondary) : null };
    const shade = (value: Shade) => {
        const tint = tints[value.ch];
        return tint ? toHex(withLuminance(tint, value.c0 + value.c1 * luminance(tint))) : value.def;
    };

    const draw = (node: BadgeNode, root = false): string => {
        if (typeof node === "string") return escape(node);
        const attrs = { ...node.a, ...(root ? { width: size, height: size } : {}) };
        const rendered = Object.entries(attrs)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${ATTRIBUTE_NAMES[k] ?? k}="${escape(typeof v === "object" ? shade(v) : String(v))}"`)
            .join(" ");
        return `<${node.t}${rendered ? ` ${rendered}` : ""}>${node.c.map((c) => draw(c)).join("")}</${node.t}>`;
    };
    return draw(template.svg, true);
}
