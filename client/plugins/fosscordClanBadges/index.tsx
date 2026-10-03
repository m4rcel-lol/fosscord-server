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

import definePlugin from "@utils/types";
import { Text } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

type Shade = { ch: "P" | "S"; c0: number; c1: number; def: string };

interface CustomBadge {
    id: number;
    name: string;
    staff_only: boolean;
    pack?: string;
    grid: string[];
    palette: Record<string, string | Shade>;
    colors: number;
}

interface BadgeProps {
    badge: number;
    primaryTintColor?: string | null;
    secondaryTintColor?: string | null;
    width?: number;
    height?: number;
    className?: string;
}

// the instance's own server tag badges, which the server puts in GLOBAL_ENV (src/util/util/ClanBadges.ts)
const env = () => (window as { GLOBAL_ENV?: { CUSTOM_CLAN_BADGES?: CustomBadge[]; CUSTOM_CLAN_BADGE_PACK?: string } }).GLOBAL_ENV ?? {};
const badges = (): CustomBadge[] => env().CUSTOM_CLAN_BADGES ?? [];
const packName = () => env().CUSTOM_CLAN_BADGE_PACK || "Custom Icon Pack";
const findBadge = (id: unknown) => badges().find((badge) => badge.id === Number(id));

type Rgb = [number, number, number];

const parseHex = (value: string): Rgb | null => {
    const hex = value.replace(/^#/, "");
    const full = hex.length === 3 || hex.length === 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
    return /^[0-9a-f]{6}$/i.test(full) ? ([0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb) : null;
};

// the client's tinting (chroma-js): a shade is the tint moved to luminance c0 + c1 * luminance(tint), the same as the CDN draws it
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

// a custom badge drawn from its pixel grid, a rect per run of same-coloured pixels in a row
function CustomBadgeIcon({ badge, primaryTintColor, secondaryTintColor, width = 24, height = 24, className }: BadgeProps) {
    const custom = findBadge(badge);
    if (!custom) return null;
    const tints = { P: primaryTintColor ? parseHex(primaryTintColor) : null, S: secondaryTintColor ? parseHex(secondaryTintColor) : null };
    const fill = (value: string | Shade) => {
        if (typeof value === "string") return value;
        const tint = tints[value.ch];
        return tint ? toHex(withLuminance(tint, value.c0 + value.c1 * luminance(tint))) : value.def;
    };
    const rects: JSX.Element[] = [];
    custom.grid.forEach((row, y) => {
        for (let x = 0; x < row.length;) {
            let end = x + 1;
            while (end < row.length && row[end] === row[x]) end++;
            const value = custom.palette[row[x]];
            if (value) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={end - x} height={1} fill={fill(value)} />);
            x = end;
        }
    });
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 16 16" fill="none" shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
            {rects}
        </svg>
    );
}

const titleCase = (name: string) => name.toLowerCase().replace(/(^|_)(\w)/g, (_, gap: string, c: string) => (gap ? " " : "") + c.toUpperCase());

export default definePlugin({
    name: "FosscordClanBadges",
    description: "Adds the instance's own server tag badges to the badge picker, for every server, and draws them in the client's colours.",
    authors: [FosscordAuthor],
    required: true,

    isCustom: (badge: unknown) => findBadge(badge) != null,
    renderBadge: (props: BadgeProps) => <CustomBadgeIcon {...props} />,
    badgeName: (badge: unknown) => {
        const custom = findBadge(badge);
        return custom ? titleCase(custom.name) : undefined;
    },

    // badge id -> how many of the server's colours it uses (1 or 2), which decides whether the accent colour is offered
    colorCounts(counts: Record<number, number>) {
        for (const badge of badges()) counts[badge.id] = badge.colors;
        return counts;
    },

    // the instance's badges in their own packs under the client's, which every server can pick from; staff-only ones are only
    // given out from the admin panel. Badge is the picker's own option component
    renderPack({
        Badge,
        selected,
        onSelect,
        className,
    }: {
        Badge: (props: { badge: { kind: number; packName: string }; isSelected: boolean; onClick: () => void }) => JSX.Element;
        selected: number;
        onSelect: (badge: number) => void;
        className: string;
    }) {
        // grouped by pack, in the order the packs first appear
        const packs = new Map<string, CustomBadge[]>();
        for (const badge of badges()) {
            if (badge.staff_only) continue;
            const name = badge.pack || packName();
            packs.set(name, [...(packs.get(name) ?? []), badge]);
        }
        return [...packs].map(([name, pack]) => (
            <div className="fosscord-badge-pack" key={name}>
                <Text variant="text-sm/semibold" color="text-strong" style={{ margin: "16px 0 8px" }}>
                    {name}
                </Text>
                <div className={className} role="group" aria-label={name}>
                    {pack.map((badge) => (
                        <Badge key={badge.id} badge={{ kind: badge.id, packName: name }} isSelected={badge.id === selected} onClick={() => onSelect(badge.id)} />
                    ))}
                </div>
            </div>
        ));
    },

    patches: [
        {
            // the badge enum's module: how many colours each badge uses
            find: '="CATERPILLAR"',
            replacement: {
                match: /let (\i)=(\{0:2,1:1,[\d:,]+\})/,
                replace: "let $1=$self.colorCounts($2)",
            },
        },
        {
            // the badge picker in the server tag settings: the instance's pack goes under the client's badges
            find: /\.unlockedBadges\.map\(\i=>\(0,\i\.jsx\)\(\i,\{badge:\i,isSelected:/,
            replacement: {
                match: /(className:(\i\.\i),children:\i\.unlockedBadges\.map\((\i)=>\(0,\i\.jsx\)\((\i),\{badge:\3,isSelected:\3\.kind===(\i),onClick:\(\)=>(\i)\(\3\.kind\)\},\3\.kind\)\)\}\),)/,
                replace: "$1$self.renderPack({Badge:$4,selected:$5,onSelect:$6,className:$2}),",
            },
        },
        {
            // the picker's label for each badge, which otherwise asserts it's one of the client's
            find: /case \i\.\i\.BEE:return \i\.intl\.string/,
            replacement: {
                match: /(case \i\.\i\.BEE:return \i\.intl\.string\([^;]+;default:)(\(0,\i\.\i\)\((\i)\))/,
                replace: "$1return $self.badgeName($3)??$2",
            },
        },
        {
            // the badge renderer, which only knows the client's badges
            find: "primaryTintLuminances",
            replacement: {
                match: /(let\{badge:(\i),primaryTintColor:\i,secondaryTintColor:\i,\.\.\.\i\}=(\i);)switch\(\2\)\{/,
                replace: "$1if($self.isCustom($2))return $self.renderBadge($3);switch($2){",
            },
        },
    ],
});
