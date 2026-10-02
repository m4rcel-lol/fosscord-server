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

// Server tag (clan) badges are drawn by the web client from its own SVG components, so the CDN can't serve
// them without that artwork. This runs the client's badge module from the downloaded cache once per badge and
// writes templates to assets/cache/clan-badges.json, which the CDN fills in with a guild's colours.
// The artwork is discord's, so it only ever lives in the (gitignored) client cache, never in the repo.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CACHE = path.join(__dirname, "..", "assets", "cache");
const OUTPUT = path.join(CACHE, "clan-badges.json");

const chunks = fs.readdirSync(CACHE).filter((f) => f.endsWith(".js"));
const read = (f) => fs.readFileSync(path.join(CACHE, f), "utf8");
const fail = (message) => {
    console.error(`[clan-badges] ${message}`);
    process.exit(1);
};

// the badge renderer: a component switching over every badge type
const rendererFile = chunks.find((f) => {
    const s = read(f);
    return s.includes("primaryTintColor") && /case [\w$]+\.[\w$]+\.SWORD:return/.test(s);
});
if (!rendererFile) fail("couldn't find the badge renderer in assets/cache, run `npm run generate:client` first");
const rendererSource = read(rendererFile);
const switchAt = rendererSource.search(/case [\w$]+\.[\w$]+\.SWORD:return/);
const headers = [...rendererSource.slice(0, switchAt).matchAll(/[,{](\d{3,7})\(([\w$]+),([\w$]+),([\w$]+)\)\{\2?/g)];
const rendererModule = headers.at(-1)?.[1];
const rendererBody = rendererSource.slice(headers.at(-1).index);
const exportName = rendererBody.match(/^[,{]\d+\([\w$]+,[\w$]+,([\w$]+)\)\{\1\.d\([\w$]+,\{([\w$]+):/)?.[2];
if (!rendererModule || !exportName) fail("couldn't read the badge renderer module");

// its imports: the jsx runtime, react, an svg props helper, chroma (default-interop'd) and the badge enum
const imports = Object.fromEntries([...rendererBody.matchAll(/([\w$]+)=[\w$]+\((\d{3,7})\)/g)].map((m) => [m[1], m[2]]));
const chromaVar = rendererBody.slice(0, 400).match(/[\w$]+=[\w$]+\.n\(([\w$]+)\)/)?.[1];
const enumVar = rendererSource.slice(switchAt).match(/case ([\w$]+)\.([\w$]+)\.SWORD/);
const enumModule = rendererSource.match(new RegExp(`${enumVar[1].replace("$", "\\$")}=[\\w$]+\\((\\d{3,7})\\)`))?.[1];
const chromaModule = imports[chromaVar];
if (!chromaModule || !enumModule) fail("couldn't resolve the badge renderer's imports");

// badge names -> ids, from the enum the client ships
const enumSource = chunks.map(read).find((s) => /\.CATERPILLAR=\d+\]="CATERPILLAR"/.test(s));
const badgeIds = Object.fromEntries(
    [...enumSource.slice(Math.max(0, enumSource.search(/\.SWORD=0\]/) - 20), enumSource.search(/\.BEE=\d+\]/) + 40).matchAll(/\.([A-Z_]+)=(\d+)\]="\1"/g)].map((m) => [
        m[1],
        Number(m[2]),
    ]),
);

// load the chunks holding the renderer and chroma, collecting their module factories
const modules = {};
const chromaFile = chunks.find((f) => read(f).includes(`${chromaModule}(e){e.exports=`) || new RegExp(`[,{]${chromaModule}\\(`).test(read(f)));
for (const file of new Set([rendererFile, chromaFile])) {
    const context = vm.createContext({});
    vm.runInContext(read(file), context);
    for (const [, factories] of context.webpackChunkdiscord_app ?? []) Object.assign(modules, factories);
}
if (!modules[rendererModule] || !modules[chromaModule]) fail("couldn't load the badge modules");

// every other import (jsx runtime, react, the svg props helper, a unique id helper) only needs these few members.
// `A` is both the svg props helper (called with props) and the id helper (called bare); ids restart per render
let nextId = 0;
const jsx = (type, props) => ({ type, props });
const shared = { jsx, jsxs: jsx, Fragment: "fragment", useMemo: (fn) => fn(), A: (props) => (props === undefined ? `b${nextId++}` : props) };
const stubs = Object.fromEntries(
    Object.values(imports)
        .filter((id) => id !== chromaModule)
        .map((id) => [id, shared]),
);
stubs[enumModule] = { [enumVar[2]]: badgeIds };

const cache = {};
const webpackRequire = (id) => {
    if (stubs[id]) return stubs[id];
    if (cache[id]) return cache[id].exports;
    const module = (cache[id] = { exports: {} });
    modules[id](module, module.exports, webpackRequire);
    return module.exports;
};
webpackRequire.d = (exports, getters) => {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(exports, key, { enumerable: true, get });
};
webpackRequire.n = (m) => {
    const getter = m && m.__esModule ? () => m.default : () => m;
    getter.a = getter;
    return getter;
};
webpackRequire.r = (exports) => Object.defineProperty(exports, "__esModule", { value: true });

// chroma stand-in: sentinel tints report a fixed luminance and turn every luminance(x).hex() into a marker,
// so a shaded fill comes out as "tint at luminance x" instead of a concrete colour
const realChroma = webpackRequire(chromaModule);
let sentinelLuminance = 0;
const SENTINELS = { "#000001": "P", "#000002": "S" };
const fakeChroma = (color, ...rest) => {
    const channel = SENTINELS[color];
    if (!channel) return realChroma(color, ...rest);
    return {
        luminance: (value) => (value === undefined ? sentinelLuminance : { hex: () => `@${channel}:${value}` }),
    };
};
Object.assign(fakeChroma, realChroma, { valid: (c) => Boolean(SENTINELS[c]) || realChroma.valid(c) });
cache[chromaModule] = { exports: fakeChroma };

const Renderer = webpackRequire(rendererModule)[exportName];
const render = (node) => {
    if (node == null || node === false) return null;
    if (Array.isArray(node)) return node.flatMap((n) => render(n) ?? []);
    if (typeof node !== "object") return String(node);
    if (typeof node.type === "function") return render(node.type(node.props));
    const { children, ...attrs } = node.props ?? {};
    const kids = render(children);
    if (node.type === "fragment") return kids;
    return { t: node.type, a: attrs, c: Array.isArray(kids) ? kids : kids == null ? [] : [kids] };
};
const draw = (badge, tints) => {
    nextId = 0;
    return render(jsx(Renderer, { badge, ...tints }));
};

// walk the default, luminance-0 and luminance-1 renders together; shaded colours become { ch, c0, c1, def }
const merge = (base, low, high) => {
    if (typeof base === "string") return base;
    const out = {};
    for (const [key, value] of Object.entries(base.a)) {
        const lo = low.a[key];
        const marker = typeof lo === "string" && lo.match(/^@([PS]):(.+)$/);
        if (marker) {
            const c0 = Number(marker[2]);
            const c1 = Number(high.a[key].match(/^@[PS]:(.+)$/)[1]);
            out[key] = { ch: marker[1], c0, c1: c1 - c0, def: value };
        } else out[key] = value;
    }
    return { t: base.t, a: out, c: base.c.map((child, i) => merge(child, low.c[i], high.c[i])) };
};

const templates = {};
for (const [name, id] of Object.entries(badgeIds)) {
    const base = draw(id, {});
    if (!base) continue;
    sentinelLuminance = 0;
    const low = draw(id, { primaryTintColor: "#000001", secondaryTintColor: "#000002" });
    sentinelLuminance = 1;
    const high = draw(id, { primaryTintColor: "#000001", secondaryTintColor: "#000002" });
    templates[id] = { name, svg: merge(base, low, high) };
}

const count = Object.keys(templates).length;
if (!count) fail("rendered no badges");
fs.writeFileSync(OUTPUT, JSON.stringify({ source: rendererFile, badges: templates }));
console.log(`[clan-badges] wrote ${count} badge templates to ${path.relative(process.cwd(), OUTPUT)}`);
