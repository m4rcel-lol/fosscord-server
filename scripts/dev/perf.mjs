import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const runs = Number(flag("runs", "3"));
const throttle = flag("throttle");
const origin = process.env.ORIGIN || `http://fosscord.localhost:${port}`;
const apiOrigin = process.env.ORIGIN || `http://localhost:${port}`;
const profiles = {
    cable: { offline: false, latency: 40, downloadThroughput: (50 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8 },
    fast4g: { offline: false, latency: 85, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
};

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);

const visit = async (context) => {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    if (profiles[throttle]) await cdp.send("Network.emulateNetworkConditions", profiles[throttle]);
    const requests = new Map();
    let identifyAt = null;
    let readyAt = null;
    let start = null;
    const entry = (id) => {
        if (!requests.has(id)) requests.set(id, { bytes: 0, received: 0 });
        return requests.get(id);
    };
    cdp.on("Network.requestWillBeSent", (e) => {
        start ??= e.timestamp;
        Object.assign(entry(e.requestId), { url: e.request.url, type: e.type, at: e.timestamp });
    });
    cdp.on("Network.requestServedFromCache", (e) => (entry(e.requestId).cached = true));
    cdp.on("Network.responseReceivedExtraInfo", (e) => (entry(e.requestId).raw = e.statusCode));
    cdp.on("Network.responseReceived", (e) => {
        const r = entry(e.requestId);
        r.status = e.response.status;
        r.protocol = e.response.protocol;
        r.encoding = e.response.headers["content-encoding"] || e.response.headers["Content-Encoding"];
        if (e.response.fromDiskCache || e.response.fromMemoryCache) r.cached = true;
    });
    cdp.on("Network.dataReceived", (e) => (entry(e.requestId).received += e.encodedDataLength));
    cdp.on("Network.loadingFinished", (e) => (entry(e.requestId).bytes = e.encodedDataLength));
    cdp.on("Network.webSocketFrameSent", (e) => {
        if (identifyAt === null && e.response.payloadData.includes('"op":2')) identifyAt = e.timestamp;
    });
    cdp.on("Network.webSocketFrameReceived", (e) => {
        if (identifyAt !== null && readyAt === null && e.response.payloadData.length > 1000) readyAt = e.timestamp;
    });
    const snapshot = () => {
        const list = [...requests.values()].filter((r) => r.url);
        const network = list.filter((r) => !r.cached && r.status !== undefined);
        return {
            requests: list.length,
            fetched: network.filter((r) => r.raw !== 304).length,
            notModified: network.filter((r) => r.raw === 304).length,
            kb: Math.round(list.reduce((a, r) => a + Math.max(r.bytes, r.received), 0) / 1024),
            protocols: [...new Set(network.map((r) => r.protocol))].join(","),
            encoded: network.filter((r) => r.encoding).length,
        };
    };

    const t0 = Date.now();
    await page.goto(`${origin}/channels/@me`);
    await page.waitForFunction(() => document.body.innerText.includes("Add Friend"), null, { timeout: 60000, polling: "raf" });
    const friends = Date.now() - t0;
    const boot = snapshot();
    await page.waitForTimeout(Number(flag("settle", "3")) * 1000);
    const settled = snapshot();
    if (process.env.DUMP) console.error(JSON.stringify([...requests.values()].map((r) => [r.raw ?? r.status, r.type, r.cached, r.bytes, r.url?.slice(0, 120)])));
    await page.close();
    return {
        friends,
        ready: readyAt && start ? Math.round((readyAt - start) * 1000) : null,
        identifyToReady: readyAt && identifyAt ? Math.round((readyAt - identifyAt) * 1000) : null,
        bootRequests: boot.requests,
        bootFetched: boot.fetched,
        boot304: boot.notModified,
        bootKb: boot.kb,
        settledRequests: settled.requests,
        settledKb: settled.kb,
        protocols: settled.protocols,
        encoded: settled.encoded,
    };
};

const results = [];
for (let i = 0, failures = 0; i < runs; i++) {
    const login = await fetch(`${apiOrigin}/api/v9/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD }),
    }).then((r) => r.json());
    const profile = mkdtempSync(join(tmpdir(), "fosscord-perf-"));
    const context = await chromium.launchPersistentContext(profile, {
        channel: "chrome",
        headless: true,
        args: process.env.SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.SPKI}`] : [],
        viewport: { width: 1440, height: 900 },
        colorScheme: "dark",
        ignoreHTTPSErrors: !process.env.SPKI,
    });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), login.token);
    const measured = await (async () => ({ cold: await visit(context), warm: await visit(context) }))().catch((e) => e);
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
    if (measured instanceof Error) {
        console.error(`run ${i} failed: ${measured.message.split("\n")[0]}`);
        if (++failures > runs) throw measured;
        i--;
        continue;
    }
    const { cold, warm } = measured;
    results.push({ cold, warm });
    console.error(JSON.stringify({ run: i, cold, warm }));
}

const median = (xs) => {
    const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? null;
};
const summary = Object.fromEntries(
    ["cold", "warm"].map((k) => [
        k,
        Object.fromEntries(
            Object.keys(results[0][k]).map((f) => [f, typeof results[0][k][f] === "number" || results[0][k][f] === null ? median(results.map((r) => r[k][f])) : results[0][k][f]]),
        ),
    ]),
);
console.log(JSON.stringify({ origin, throttle: throttle || "none", runs, ...summary }, null, 2));
