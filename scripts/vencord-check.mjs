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

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = (process.env.ORIGIN || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, "");
const timeout = Number(process.env.CHECK_TIMEOUT || 240) * 1000;
const reportPath = process.env.CHECK_REPORT || path.join(ROOT, "assets", "vencord", "report.json");

const reporterScript = path.join(ROOT, "assets", "vencord", "reporter.js");
if (!existsSync(reporterScript)) {
    console.error("assets/vencord/reporter.js is missing, run `node scripts/vencord.js --reporter` first");
    process.exit(2);
}

const playwright = (() => {
    for (const base of [path.join(ROOT, "package.json"), path.join(homedir(), ".cache", "fosscord-tools", "package.json")]) {
        try {
            return createRequire(base)("playwright-core");
        } catch {
            continue;
        }
    }
    console.error("playwright-core is not installed, run `npm i -D playwright-core` or install it in ~/.cache/fosscord-tools");
    process.exit(2);
})();

const pluginDir = path.join(ROOT, "client", "plugins");
const ours = new Set(
    (existsSync(pluginDir) ? readdirSync(pluginDir) : [])
        .flatMap((dir) => ["index.ts", "index.tsx"].map((file) => path.join(pluginDir, dir, file)))
        .filter((file) => existsSync(file))
        .map((file) => readFileSync(file, "utf8").match(/definePlugin\(\{\s*name:\s*"([^"]+)"/)?.[1])
        .filter(Boolean),
);
const config = JSON.parse(readFileSync(path.join(ROOT, "client", "vencord.json"), "utf8"));
const enabled = new Set(Object.entries(config.plugins ?? {}).flatMap(([name, value]) => ((typeof value === "boolean" ? value : value.enabled) ? [name] : [])));

const ping = await fetch(`${origin}/api/v9/ping`).catch(() => null);
if (!ping?.ok) {
    console.error(`no server answering at ${origin}, start it or set ORIGIN`);
    process.exit(2);
}

const report = { badPatches: [], badFinds: [], badStarts: [], errors: [], unmatchedAllPatches: [], meta: null };

const unmatchedAllPatches = (names) => {
    const sources = Object.values(Vencord.Webpack.wreq.m).map(String);
    return names.flatMap((name) =>
        (Vencord.Plugins.plugins[name]?.patches ?? [])
            .filter((patch) => patch.all)
            .filter((patch) => !sources.some((code) => (typeof patch.find === "string" ? code.includes(patch.find) : ((patch.find.lastIndex = 0), patch.find.test(code)))))
            .map((patch) => ({ plugin: name, find: String(patch.find) })),
    );
};
const browser = await playwright.chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), headless: true });
const page = await browser.newPage();
await page.route(/\/assets\/vencord\/vencord\.js/, (route) => route.fulfill({ contentType: "text/javascript", body: readFileSync(reporterScript, "utf8") }));

let finish;
const finished = new Promise((resolve) => (finish = resolve));
const describe = (handle) => handle.evaluate((value) => (value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value))).catch(() => "");

page.on("console", async (message) => {
    const args = message.args();
    const first = args[0] ? await describe(args[0]) : "";
    if (first === "[REPORTER_META]") {
        report.meta = JSON.parse(await describe(args[1]));
        return;
    }
    if (first !== "[Vencord]") return;
    const [tag, text, extra] = await Promise.all(args.slice(1, 4).map(describe));
    if (tag === "WebpackPatcher:") {
        const failure = text.match(/Patch by (.+?) (had no effect|errored|found no module) \(Module id is (.+?)\): ([\s\S]+)/);
        if (failure) report.badPatches.push({ plugin: failure[1], type: failure[2], module: failure[3], match: failure[4], error: extra || undefined });
    } else if (tag === "PluginManager:") {
        const failure = text.match(/Failed to start (.+)/);
        if (failure) report.badStarts.push({ plugin: failure[1], error: extra || "unknown error" });
    } else if (tag === "Reporter:" || tag === "LazyChunkLoader:") {
        if (text === "Webpack Find Fail:") report.badFinds.push(extra);
        else if (text === "A fatal error occurred:") {
            report.errors.push(`${tag} ${extra}`);
            finish("fatal");
        } else if (text === "Finished test") {
            report.unmatchedAllPatches = await page.evaluate(unmatchedAllPatches, [...ours]).catch((e) => [{ plugin: "check", find: String(e) }]);
            finish("done");
        }
    }
});
page.on("pageerror", (error) => {
    if (!/Sentry successfully disabled/.test(error.message)) report.errors.push(error.message.slice(0, 300));
});

const started = Date.now();
await page.goto(`${origin}/login`);
const outcome = await Promise.race([finished, new Promise((resolve) => setTimeout(() => resolve("timeout"), timeout))]);
await browser.close().catch(() => {});

const owner = (plugin) => (ours.has(plugin) ? "fosscord" : enabled.has(plugin) ? "enabled" : "upstream");
const findOwner = (find) => [...ours].find((name) => find.includes(name));
writeFileSync(reportPath, JSON.stringify({ outcome, origin, seconds: Math.round((Date.now() - started) / 1000), ...report }, null, 4));

const groups = { fosscord: [], enabled: [], upstream: [] };
for (const patch of report.badPatches)
    groups[owner(patch.plugin)].push(`${patch.plugin}: patch ${patch.type}\n      ${patch.match.slice(0, 220)}${patch.error ? `\n      ${patch.error.slice(0, 220)}` : ""}`);
for (const start of report.badStarts) groups[owner(start.plugin)].push(`${start.plugin}: failed to start\n      ${start.error.slice(0, 220)}`);
for (const patch of report.unmatchedAllPatches) groups.fosscord.push(`${patch.plugin}: patch found no module\n      ${patch.find.slice(0, 220)}`);
for (const find of report.badFinds) groups[findOwner(find) ? "fosscord" : "upstream"].push(`webpack find failed\n      ${find.slice(0, 220)}`);

console.log(`Vencord check against ${origin} (${outcome}, ${Math.round((Date.now() - started) / 1000)}s, build ${report.meta?.buildNumber ?? "unknown"})`);
for (const [group, title] of [
    ["fosscord", "Fosscord plugins"],
    ["enabled", "Upstream plugins enabled by default"],
    ["upstream", "Other upstream plugins (disabled by default, informational)"],
]) {
    console.log(`\n${title}: ${groups[group].length ? `${groups[group].length} problem(s)` : "ok"}`);
    for (const line of groups[group]) console.log(`  - ${line}`);
}
if (report.errors.length) console.log(`\nPage errors:\n${[...new Set(report.errors)].map((e) => `  - ${e}`).join("\n")}`);
console.log(`\nFull report written to ${path.relative(ROOT, reportPath)}`);

if (outcome !== "done") {
    console.error(`\nThe reporter did not finish (${outcome}).`);
    process.exit(1);
}
process.exit(groups.fosscord.length || groups.enabled.length ? 1 : 0);
