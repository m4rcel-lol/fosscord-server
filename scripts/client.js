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

const path = require("path");
const vm = require("vm");
const fs = require("fs/promises");
const { existsSync } = require("fs");

const BASE_URL = process.env.CLIENT_BASE_URL || "https://discord.com";
const CACHE_PATH = path.join(__dirname, "..", "assets", "cache");
const INSTANCE_NAME = process.env.INSTANCE_NAME || "Fosscord";
const CONCURRENCY = Number(process.env.CLIENT_CONCURRENCY || 8);
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const MEDIA_EXT = "svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|json|lottie|wasm";
const ASSET_NAME = new RegExp(`(?:^|["'(/\\s])((?:[\\w-]+\\.)?[0-9a-f]{8,32}\\.(?:js|css|${MEDIA_EXT}))(?=["')?#\\s]|$)`, "g");
const TEXT_EXT = /\.(js|css|json)$/;

const patch = (content) =>
    content
        .replaceAll("delete window.localStorage", "void 0")
        .replaceAll('"https:"+window.GLOBAL_ENV', " location.protocol+window.GLOBAL_ENV")
        .replaceAll("returnlocation.protocol", "return location.protocol")
        .replaceAll("`https:${window.GLOBAL_ENV", "`${location.protocol}${window.GLOBAL_ENV")
        .replaceAll("`https://${", "`${location.protocol}//${")
        .replace(/Discord Nitro/g, `${INSTANCE_NAME} Premium`)
        .replace(/(["> ])Nitro([ ."<,!?])/g, "$1Premium$2")
        .replace(/(["> ])Discord(['’]s|[ ."<,!?:])/g, `$1${INSTANCE_NAME}$2`);

const sliceExpression = (source, start) => {
    const closers = { "(": ")", "[": "]", "{": "}" };
    const stack = [];
    let quote = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === "\\") i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (closers[ch]) stack.push(closers[ch]);
        else if (ch === ")" || ch === "]" || ch === "}") {
            if (!stack.length) return source.slice(start, i);
            stack.pop();
        } else if ((ch === "," || ch === ";") && !stack.length) return source.slice(start, i);
    }
    return source.slice(start);
};

const chunkNames = (source) => {
    const names = new Set();
    for (const marker of [".u=e=>", ".k=e=>"]) {
        const at = source.indexOf(marker);
        if (at === -1) continue;
        const body = sliceExpression(source, at + marker.length);
        const ids = new Set([...body.matchAll(/"(\d+)"===e/g), ...body.matchAll(/[{,](\d+(?:e\d+)?):"[0-9a-f]+"/g)].map((m) => String(Number(m[1]))));
        let fn;
        try {
            fn = vm.runInNewContext(`(e=>${body})`);
        } catch {
            continue;
        }
        for (const id of ids) {
            const name = fn(id);
            if (typeof name === "string" && !name.includes("undefined")) names.add(name);
        }
    }
    return names;
};

const references = (text) => new Set([...text.matchAll(ASSET_NAME)].map((m) => m[1]));

(async () => {
    await fs.mkdir(CACHE_PATH, { recursive: true });
    const started = Date.now();

    const appRes = await fetch(`${BASE_URL}/app`, { headers: { "user-agent": USER_AGENT } });
    if (!appRes.ok) throw new Error(`GET /app returned ${appRes.status}`);
    const html = await appRes.text();
    await fs.writeFile(path.join(CACHE_PATH, "index.html"), html);

    const queue = [...new Set([...html.matchAll(/\/assets\/([\w.-]+)/g)].map((m) => m[1]))];
    const seen = new Set(queue);
    const failed = [];
    let done = 0;
    let bytes = 0;

    const enqueue = (names) => {
        for (const name of names) {
            if (seen.has(name)) continue;
            seen.add(name);
            queue.push(name);
        }
    };

    const fetchAsset = async (name) => {
        const file = path.join(CACHE_PATH, name);
        const isText = TEXT_EXT.test(name);
        if (existsSync(file)) {
            if (!isText) return;
            const text = await fs.readFile(file, "utf8");
            enqueue(references(text));
            if (/^web\.[0-9a-f]+\.js$/.test(name)) enqueue(chunkNames(text));
            const patched = name.endsWith(".json") ? text : patch(text);
            if (patched !== text) await fs.writeFile(file, patched);
            return;
        }
        const res = await fetch(`${BASE_URL}/assets/${name}`, { headers: { "user-agent": USER_AGENT } });
        if (!res.ok) {
            failed.push(`${res.status} ${name}`);
            return;
        }
        if (!isText) {
            const buf = Buffer.from(await res.arrayBuffer());
            bytes += buf.length;
            await fs.writeFile(file, buf);
            return;
        }
        const text = await res.text();
        bytes += text.length;
        enqueue(references(text));
        if (/^web\.[0-9a-f]+\.js$/.test(name)) enqueue(chunkNames(text));
        await fs.writeFile(file, name.endsWith(".json") ? text : patch(text));
    };

    const report = setInterval(() => {
        process.stdout.write(`\r${done}/${seen.size} assets, ${(bytes / 1048576).toFixed(1)} MB, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)}s   `);
    }, 1000);

    let inflight = 0;
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            while (queue.length || inflight) {
                const name = queue.shift();
                if (!name) {
                    await new Promise((r) => setTimeout(r, 100));
                    continue;
                }
                inflight++;
                await fetchAsset(name).catch((e) => failed.push(`${e.message} ${name}`));
                inflight--;
                done++;
            }
        }),
    );

    clearInterval(report);
    await fs.writeFile(path.join(CACHE_PATH, "..", "cacheFailures"), failed.join("\n"));
    console.log(`\nDone: ${done} assets, ${(bytes / 1048576).toFixed(1)} MB in ${Math.round((Date.now() - started) / 1000)}s, ${failed.length} failed (see assets/cacheFailures)`);
})();
