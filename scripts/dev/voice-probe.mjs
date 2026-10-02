import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const wait = Number(flag("wait", "10")) * 1000;
const executablePath = flag("browser");
const origin = `http://fosscord.localhost:${port}`;
const api = `http://localhost:${port}/api/v9`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);
const users = {
    tester: { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD },
    friend: { login: "friend@fosscord.test", password: accounts.FRIEND_PASSWORD },
};
const call = async (token, method, path, body) =>
    fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: token }, body: body && JSON.stringify(body) }).then((r) => r.json());
const tokens = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([name, body]) => [name, (await call(undefined, "POST", "/auth/login", body)).token])));

const [guild] = await call(tokens.tester, "GET", "/users/@me/guilds");
const channels = await call(tokens.tester, "GET", `/guilds/${guild.id}/channels`);
const voice = channels.find((c) => c.type === 2) ?? (await call(tokens.tester, "POST", `/guilds/${guild.id}/channels`, { name: "General", type: 2 }));

const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

const pages = {};
for (const [name, token] of Object.entries(tokens)) {
    const context = await browser.newContext({ permissions: ["microphone", "camera"] });
    await context.addInitScript((value) => {
        localStorage.setItem("token", JSON.stringify(value));
        window.__pcs = [];
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(Native, {
            construct(target, ctorArgs) {
                const pc = new target(...ctorArgs);
                window.__pcs.push(pc);
                return pc;
            },
        });
    }, token);
    await context.route(/^https:\/\/([a-z0-9-]+\.)*(discord|discordapp)\.(com|net|media|gg)\//, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me`);
    pages[name] = page;
}
await sleep(15000);

const join = (page, channelId) =>
    page.evaluate((id) => {
        const requires = [];
        window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
        for (const req of requires)
            for (const mid of Object.keys(req.m)) {
                if (!req.m[mid].toString().includes("selectVoiceChannel(e){")) continue;
                const exports = req(mid);
                for (const key of Object.keys(exports)) if (typeof exports[key]?.selectVoiceChannel === "function") return exports[key].selectVoiceChannel(id);
            }
    }, channelId);

await join(pages.tester, voice.id);
await sleep(3000);
await join(pages.friend, voice.id);
await sleep(wait);

for (const [name, page] of Object.entries(pages)) {
    const inbound = await page.evaluate(async () => {
        const rows = [];
        for (const pc of window.__pcs) {
            if (pc.connectionState === "closed") continue;
            (await pc.getStats()).forEach((r) => r.type === "inbound-rtp" && rows.push({ kind: r.kind, bytes: r.bytesReceived, energy: r.totalAudioEnergy, framesDecoded: r.framesDecoded }));
        }
        return rows;
    });
    console.log(JSON.stringify({ user: name, channel: voice.name, inbound }));
}
await browser.close();
