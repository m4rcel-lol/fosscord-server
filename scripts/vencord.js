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

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "vencord.json"), "utf8"));
const PLUGINS = path.join(ROOT, "client", "plugins");
const SOURCE_PATCHES = path.join(ROOT, "client", "vencord-patches");
const CACHE = path.resolve(process.env.VENCORD_DIR || path.join(ROOT, ".vencord"));
const SOURCE = path.join(CACHE, "src");
const OUTPUT = path.join(ROOT, "assets", "vencord");
const reporter = process.argv.includes("--reporter");

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { cwd: SOURCE, stdio: "inherit", ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
};

const succeeds = (command, args) => spawnSync(command, args, { cwd: SOURCE, stdio: "ignore" }).status === 0;

const checkout = () => {
    fs.mkdirSync(SOURCE, { recursive: true });
    if (!fs.existsSync(path.join(SOURCE, ".git"))) {
        run("git", ["init", "-q"]);
        run("git", ["remote", "add", "origin", CONFIG.repository]);
    }
    if (!succeeds("git", ["cat-file", "-e", `${CONFIG.commit}^{commit}`])) {
        console.log(`[vencord] fetching ${CONFIG.commit}`);
        run("git", ["fetch", "-q", "--depth", "1", "origin", CONFIG.commit]);
    }
    run("git", ["checkout", "-q", "--force", CONFIG.commit]);
    if (!fs.existsSync(SOURCE_PATCHES)) return;
    for (const patch of fs
        .readdirSync(SOURCE_PATCHES)
        .filter((x) => x.endsWith(".patch"))
        .sort()) {
        console.log(`[vencord] applying ${patch}`);
        run("git", ["apply", "--whitespace=nowarn", path.join(SOURCE_PATCHES, patch)]);
    }
};

const pnpm = () => {
    for (const candidate of [["pnpm"], ["corepack", "pnpm"], ["npx", "-y", "pnpm@11"]]) {
        if (succeeds(candidate[0], [...candidate.slice(1), "--version"])) return candidate;
    }
    throw new Error("could not find pnpm, corepack or npx");
};

const install = (pm) => {
    const lockfile = fs.readFileSync(path.join(SOURCE, "pnpm-lock.yaml"));
    const stamp = path.join(CACHE, "install.stamp");
    const hash = crypto.createHash("sha256").update(lockfile).digest("hex");
    if (fs.existsSync(path.join(SOURCE, "node_modules")) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === hash) return;
    console.log("[vencord] installing dependencies");
    run(pm[0], [...pm.slice(1), "install", "--frozen-lockfile"], { env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } });
    fs.writeFileSync(stamp, hash);
};

const copyPlugins = () => {
    const target = path.join(SOURCE, "src", "userplugins");
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    if (!fs.existsSync(PLUGINS)) return [];
    const names = fs.readdirSync(PLUGINS).filter((x) => !x.startsWith("."));
    for (const name of names) fs.cpSync(path.join(PLUGINS, name), path.join(target, name), { recursive: true });
    return names;
};

const seedDefaults = (defaults) => `(() => {
    const defaults = ${JSON.stringify(defaults)};
    try {
        const settings = JSON.parse(localStorage.getItem("VencordSettings") || "{}");
        const seeded = new Set(JSON.parse(localStorage.getItem("FosscordVencordSeeded") || "[]"));
        settings.plugins ??= {};
        for (const [name, value] of Object.entries(defaults.plugins)) {
            if (seeded.has(name)) continue;
            seeded.add(name);
            settings.plugins[name] = { ...settings.plugins[name], ...(typeof value === "boolean" ? { enabled: value } : value) };
        }
        for (const [key, value] of Object.entries(defaults.settings)) settings[key] ??= value;
        localStorage.setItem("VencordSettings", JSON.stringify(settings));
        localStorage.setItem("FosscordVencordSeeded", JSON.stringify([...seeded]));
    } catch (e) {
        console.error("[vencord] could not seed default settings", e);
    }
})();
`;

const writeOutput = (version) => {
    const dist = path.join(SOURCE, "dist");
    const css = fs.readFileSync(path.join(dist, "extension.css"));
    const cssHash = crypto.createHash("sha256").update(css).digest("hex").slice(0, 12);
    const bundle = fs.readFileSync(path.join(dist, "extension.js"), "utf8").replace(/\n\/\/# sourceURL=[^\n]*\s*$/, "\n");
    const meta = `window.postMessage({ type: "vencord:meta", meta: { EXTENSION_VERSION: ${JSON.stringify(version)}, EXTENSION_BASE_URL: \`\${location.origin}/\`, RENDERER_CSS_URL: "/assets/vencord/vencord.css?v=${cssHash}" } }, "*");\n`;
    const script = `${seedDefaults({ plugins: CONFIG.plugins ?? {}, settings: CONFIG.settings ?? {} })}${bundle}${meta}//# sourceURL=file:///VencordWeb\n`;

    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, reporter ? "reporter.js" : "vencord.js"), script);
    if (reporter) return;
    fs.writeFileSync(path.join(OUTPUT, "vencord.css"), css);
    fs.rmSync(path.join(OUTPUT, "vendor"), { recursive: true, force: true });
    fs.cpSync(path.join(dist, "vendor"), path.join(OUTPUT, "vendor"), { recursive: true });
};

(() => {
    const started = Date.now();
    checkout();
    const pm = pnpm();
    install(pm);
    const plugins = copyPlugins();
    console.log(`[vencord] building ${reporter ? "reporter" : "web"} target with ${plugins.length} fosscord plugins`);
    run(pm[0], [...pm.slice(1), "buildWeb", "--skip-extension", ...(reporter ? ["--reporter"] : [])], {
        env: { ...process.env, VENCORD_HASH: CONFIG.commit.slice(0, 7) },
    });
    const { version } = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8"));
    writeOutput(version);
    fs.writeFileSync(
        path.join(OUTPUT, reporter ? "reporter.json" : "build.json"),
        JSON.stringify({ commit: CONFIG.commit, version, plugins, builtAt: new Date().toISOString() }, null, 4),
    );
    console.log(`[vencord] wrote ${path.relative(ROOT, OUTPUT)} in ${Math.round((Date.now() - started) / 1000)}s`);
})();
