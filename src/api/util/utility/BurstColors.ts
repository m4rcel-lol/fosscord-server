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

import { Config } from "@spacebar/util";
import { PartialEmoji } from "@spacebar/schemas";

const cache = new Map<string, string[]>();

const twemojiCode = (name: string) => [...(name.includes("‍") ? name : name.replace(/️/g, ""))].map((char) => char.codePointAt(0)!.toString(16)).join("-");

const emojiImageUrl = (emoji: PartialEmoji) =>
    emoji.id
        ? `${(Config.get().cdn.endpointPrivate || "").replace(/\/+$/, "")}/emojis/${emoji.id}.png?size=64`
        : `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${twemojiCode(emoji.name ?? "")}.png`;

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

function palette(data: Buffer | Uint8Array, count = 2) {
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        bucket.n++;
        buckets.set(key, bucket);
    }
    const colors: [number, number, number][] = [];
    for (const { r, g, b, n } of [...buckets.values()].sort((a, b) => b.n - a.n)) {
        const color: [number, number, number] = [r / n, g / n, b / n];
        if (colors.some((c) => Math.abs(c[0] - color[0]) + Math.abs(c[1] - color[1]) + Math.abs(c[2] - color[2]) < 96)) continue;
        colors.push(color);
        if (colors.length >= count) break;
    }
    return colors.map(([r, g, b]) => `#${hex(r)}${hex(g)}${hex(b)}`);
}

export async function getBurstColors(emoji: PartialEmoji): Promise<string[]> {
    const key = emoji.id ?? emoji.name ?? "";
    const cached = cache.get(key);
    if (cached) return cached;

    let colors: string[] = [];
    try {
        const res = await fetch(emojiImageUrl(emoji), { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const { Jimp } = await import("jimp");
            const image = await Jimp.read(Buffer.from(await res.arrayBuffer()));
            colors = palette(image.bitmap.data);
        }
    } catch {
        colors = [];
    }
    if (colors.length) cache.set(key, colors);
    return colors;
}
