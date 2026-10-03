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

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const OUTPUT = path.join(__dirname, "..", "assets", "badge-icons");
const PNG_SIZE = 72;
const LIGHT = [-Math.SQRT1_2, -Math.SQRT1_2];

const gems = [
    { months: 1, cut: "hexagon", palette: ["#ffd9b8", "#eba16a", "#c8733a", "#94491f", "#5c2a10"] },
    { months: 3, cut: "hexagon", palette: ["#ffffff", "#e4e9ef", "#b8c1cc", "#8590a0", "#545e6c"] },
    { months: 6, cut: "hexagon", palette: ["#fff4c2", "#ffd659", "#f2ab1d", "#bf7a08", "#774a04"] },
    { months: 12, cut: "brilliant", palette: ["#f2fdff", "#bdeef8", "#82d2e6", "#4aa3bf", "#256b84"] },
    { months: 24, cut: "brilliant", palette: ["#f4f2ff", "#cdc6ff", "#9f8fff", "#6d5cf2", "#3f2fae"] },
    { months: 36, cut: "step", palette: ["#e0ffd6", "#86e67e", "#35b84c", "#14863a", "#06501f"] },
    { months: 60, cut: "round", palette: ["#ffdbe3", "#ff8098", "#e8315a", "#ad113b", "#650420"] },
    { months: 72, cut: "opal", palette: ["#ffffff", "#f3eefc", "#d9d2ee", "#a99ccc", "#6f6396"] },
];

const fmt = (n) => Number(n.toFixed(2));
const pts = (list) => list.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
const polygon = (list, fill, edge) =>
    `<polygon points="${pts(list)}" fill="${fill}"${edge ? ` stroke="${edge}" stroke-width="0.3" stroke-opacity="0.45" stroke-linejoin="round"` : ""}/>`;
const ring = (cx, cy, r, count, offset) =>
    Array.from({ length: count }, (_, i) => [cx + r * Math.cos(((offset + (360 / count) * i) * Math.PI) / 180), cy + r * Math.sin(((offset + (360 / count) * i) * Math.PI) / 180)]);

const shade = (palette, facet, center) => {
    const cx = facet.reduce((a, [x]) => a + x, 0) / facet.length - center[0];
    const cy = facet.reduce((a, [, y]) => a + y, 0) / facet.length - center[1];
    const length = Math.hypot(cx, cy) || 1;
    const light = (cx / length) * LIGHT[0] + (cy / length) * LIGHT[1];
    return palette[light > 0.6 ? 0 : light > 0.1 ? 1 : light > -0.4 ? 2 : light > -0.8 ? 3 : 4];
};

const framed = (outline, facets, table, palette, center) => {
    const body = facets.map((facet) => polygon(facet, shade(palette, facet, center), palette[4])).join("");
    return `${body}${polygon(table, palette[1], palette[4])}<polygon points="${pts(outline)}" fill="none" stroke="${palette[4]}" stroke-width="0.8" stroke-linejoin="round"/>`;
};

const bands = (outer, inner) => outer.map((point, i) => [point, outer[(i + 1) % outer.length], inner[(i + 1) % inner.length], inner[i]]);

const cuts = {
    hexagon(palette) {
        const outer = ring(12, 12, 10.2, 6, -90);
        const inner = ring(12, 12, 5, 6, -90);
        return `${framed(outer, bands(outer, inner), inner, palette, [12, 12])}${polygon([inner[5], inner[0], [12, 9.6]], palette[0])}`;
    },
    step(palette) {
        const octagon = (x0, y0, x1, y1, c) => [
            [x0 + c, y0],
            [x1 - c, y0],
            [x1, y0 + c],
            [x1, y1 - c],
            [x1 - c, y1],
            [x0 + c, y1],
            [x0, y1 - c],
            [x0, y0 + c],
        ];
        const outer = octagon(4, 2, 20, 22, 3.6);
        const middle = octagon(6.2, 4.6, 17.8, 19.4, 2.4);
        const inner = octagon(8.4, 7.2, 15.6, 16.8, 1.3);
        const facets = [...bands(outer, middle), ...bands(middle, inner)];
        return `${framed(outer, facets, inner, palette, [12, 12])}${polygon([inner[7], inner[0], [12.6, 7.2], [9.6, 10.4], [8.4, 10.4]], palette[0])}`;
    },
    round(palette) {
        const outer = ring(12, 12, 10.4, 8, -90);
        const star = ring(12, 12, 7.4, 8, -67.5);
        const table = ring(12, 12, 5, 8, -90);
        const girdle = outer.map((point, i) => [point, outer[(i + 1) % 8], star[i]]);
        const stars = star.map((point, i) => [table[i], table[(i + 1) % 8], point]);
        const kites = outer.map((point, i) => [star[(i + 7) % 8], point, star[i], table[i]]);
        return `${framed(outer, [...girdle, ...kites, ...stars], table, palette, [12, 12])}${polygon([table[6], table[7], table[0], [12, 12]], palette[0])}`;
    },
    brilliant(palette) {
        const outline = [
            [7, 3.5],
            [17, 3.5],
            [21.5, 9],
            [12, 21.5],
            [2.5, 9],
        ];
        const crown = [
            [[2.5, 9], [7, 3.5], [8.6, 9], palette[1]],
            [[7, 3.5], [12, 3.5], [8.6, 9], palette[0]],
            [[12, 3.5], [8.6, 9], [15.4, 9], palette[1]],
            [[12, 3.5], [17, 3.5], [15.4, 9], palette[2]],
            [[17, 3.5], [21.5, 9], [15.4, 9], palette[3]],
        ];
        const pavilion = [
            [[2.5, 9], [8.6, 9], [12, 21.5], palette[2]],
            [[8.6, 9], [15.4, 9], [12, 21.5], palette[1]],
            [[15.4, 9], [21.5, 9], [12, 21.5], palette[3]],
        ];
        const facets = [...crown, ...pavilion].map((facet) => polygon(facet.slice(0, -1), facet.at(-1), palette[4])).join("");
        return `${facets}<polygon points="${pts(outline)}" fill="none" stroke="${palette[4]}" stroke-width="0.8" stroke-linejoin="round"/>`;
    },
    opal(palette) {
        const spots = [
            [8.6, 9.4, 6, "#ff7fbd"],
            [16, 9, 5.6, "#5cc6ff"],
            [9.6, 16.2, 5.8, "#4fe0a4"],
            [15.6, 16, 5.2, "#a882ff"],
            [12.4, 12.4, 3.4, "#ffd36b"],
        ];
        const gradients = spots
            .map(
                ([cx, cy, r, color], i) =>
                    `<radialGradient id="o${i}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity="0.9"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
            )
            .join("");
        const fills = spots.map((_, i) => `<ellipse cx="12" cy="12" rx="7.4" ry="9.8" fill="url(#o${i})"/>`).join("");
        return `<defs><clipPath id="c"><ellipse cx="12" cy="12" rx="7.4" ry="9.8"/></clipPath>${gradients}</defs><ellipse cx="12" cy="12" rx="7.4" ry="9.8" fill="${palette[1]}"/><g clip-path="url(#c)">${fills}<ellipse cx="9.4" cy="7.6" rx="2.6" ry="1.5" transform="rotate(-35 9.4 7.6)" fill="${palette[0]}" fill-opacity="0.85"/></g><ellipse cx="12" cy="12" rx="7.4" ry="9.8" fill="none" stroke="${palette[4]}" stroke-width="0.8"/>`;
    },
};

(async () => {
    for (const { months, cut, palette } of gems) {
        const name = `premium_tenure_${months}_month_v2`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${cuts[cut](palette)}</svg>\n`;
        fs.writeFileSync(path.join(OUTPUT, `${name}.svg`), svg);
        await sharp(Buffer.from(svg), { density: (72 * PNG_SIZE) / 24 })
            .resize(PNG_SIZE, PNG_SIZE)
            .png({ compressionLevel: 9 })
            .toFile(path.join(OUTPUT, `${name}.png`));
        console.log(`[tenure-badges] wrote ${name}`);
    }
})();
