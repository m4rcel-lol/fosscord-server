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

const fs = require("node:fs");
const path = require("node:path");

const CACHE_PATH = path.join(__dirname, "..", "assets", "cache");

const anchors = [
    { name: "webpack chunk global", hook: "loader", pattern: /webpackChunkdiscord_app/ },
    { name: "Flux dispatcher interceptors", hook: "dispatcher", pattern: /addInterceptor\(\w+\)\{/ },
    { name: "Flux dispatcher subscribe", hook: "dispatcher", pattern: /subscribe\(\w+,\w+\)\{/ },
    { name: "gateway dispatch handler slot", hook: "gateway", pattern: /getDispatchHandler=null/ },
    { name: "gateway preload before flush", hook: "gateway", pattern: /getDispatchHandler\(\w+\.type\)\?\.preload\(\w+\.data\)/ },
    { name: "gateway store getSocket", hook: "gateway", pattern: /getSocket\(\)\{return \w+\}isTryingToConnect\(\)\{/ },
    { name: "MESSAGE_CREATE preload handler", hook: "gateway", pattern: /\(\["MESSAGE_CREATE"\],\w+=>/ },
    { name: "HTTP client methods", hook: "http", pattern: /=\{get:\w+,post:\w+,put:\w+,patch:\w+,del:\w+\}/ },
    { name: "HTTP callback with response", hook: "http", pattern: /\{hasErr:!1,\.\.\.\w+\}/ },
    { name: "message queue posts through HTTP client", hook: "http", pattern: /\.Bo\.post\(\{url:\w+\.\w+\.MESSAGES\(\w+\),body:\w+/ },
    { name: "message queue edits through HTTP client", hook: "http", pattern: /\.Bo\.patch\(\w+,\w+\)/ },
    { name: "message content element id", hook: "ui", pattern: /message-content-/ },
];

if (!fs.existsSync(path.join(CACHE_PATH, "index.html"))) {
    console.error("assets/cache/index.html is missing, run `npm run generate:client` first");
    process.exit(1);
}

const html = fs.readFileSync(path.join(CACHE_PATH, "index.html"), "utf8");
const entry = [...html.matchAll(/src="\/assets\/([\w.-]+\.js)"/g)].map((m) => m[1]);
const rest = fs.readdirSync(CACHE_PATH).filter((f) => f.endsWith(".js") && !entry.includes(f));

const pending = new Map(anchors.map((a) => [a.name, a]));
const found = new Map();
for (const file of [...entry, ...rest]) {
    if (!pending.size) break;
    const source = fs.readFileSync(path.join(CACHE_PATH, file), "utf8");
    for (const [name, anchor] of pending) {
        if (!anchor.pattern.test(source)) continue;
        found.set(name, file);
        pending.delete(name);
    }
}

for (const anchor of anchors)
    console.log(`${found.has(anchor.name) ? "ok     " : "MISSING"} [${anchor.hook}] ${anchor.name}${found.has(anchor.name) ? ` (${found.get(anchor.name)})` : ""}`);
if (pending.size) {
    console.error(`\n${pending.size} e2ee anchor(s) missing. The client will show "E2EE unavailable" and refuse to send in encrypted channels until client/e2ee/src is updated.`);
    process.exit(1);
}
console.log("\nall e2ee anchors present");
