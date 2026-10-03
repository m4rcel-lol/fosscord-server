import { createRequire } from "node:module";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const port = process.env.PORT || "3001";
const out = process.env.OUT || "members-ui";
const { guild, general, tester, users } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const token = process.env.USER_INDEX ? users[Number(process.env.USER_INDEX)].token : tester.token;
const brave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ ...(existsSync(brave) ? { executablePath: brave } : { channel: "chrome" }), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((value) => {
    if (!localStorage.getItem("token")) localStorage.setItem("token", JSON.stringify(value));
    window.__listOps = [];
    const Native = window.WebSocket;
    window.WebSocket = new Proxy(Native, {
        construct(target, args) {
            const socket = new target(...args);
            const send = socket.send.bind(socket);
            socket.send = (data) => {
                if (typeof data === "string" && /"op":(14|37)/.test(data)) window.__listOps.push(`out ${data.slice(0, 300)}`);
                return send(data);
            };
            return socket;
        },
    });
}, token);
await context.route(/^https:\/\/([a-z0-9-]+\.)*(discord|discordapp)\.(com|net|media|gg)\//, (route) => route.abort());
const page = await context.newPage();
const consoleLines = [];
page.on("console", (msg) => /patch|error/i.test(msg.text()) && consoleLines.push(msg.text().slice(0, 200)));
const requests = [];
const failures = [];
page.on("response", (res) => {
    if (res.url().includes("/messages?")) requests.push(`${res.status()} ${Math.round(res.request().timing().responseEnd)}ms ${res.url().split("/api/v9")[1]}`);
    if (res.url().includes("/api/") && res.status() >= 400) failures.push(`${res.status()} ${res.request().method()} ${res.url().split("/api/v9")[1]}`);
});
await page.goto(`http://fosscord.localhost:${port}/channels/${guild}/${general}`);
await page.waitForSelector('[data-list-id="chat-messages"]', { timeout: 60_000 });
await sleep(4000);
for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
await sleep(500);
await page.screenshot({ path: `${out}-1.png` });
const memberList = await page.locator('[class*="membersWrap"], aside[class*="member"]').count();
console.log("member list panels", memberList);

if (process.env.SCROLL) {
    const rounds = Number(process.env.SCROLL);
    const started = Date.now();
    for (let i = 0; i < rounds; i++) {
        await page.mouse.move(780, 450);
        for (let j = 0; j < 8; j++) {
            await page.mouse.wheel(0, -400);
            await sleep(50);
        }
    }
    console.log(`scrolled ${rounds} rounds in ${Date.now() - started} ms`);
    console.log(`message requests ${requests.length}, 429s ${requests.filter((x) => x.startsWith("429")).length}`);
    console.log(requests.join("\n"));
    await page.screenshot({ path: `${out}-scroll.png` });
}

if (process.env.LIVE) {
    const WebSocket = createRequire(import.meta.url)("ws");
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const online = users.slice(0, 4).map(({ token: userToken }, i) => {
        const ws = new WebSocket(`ws://localhost:${port}/?encoding=json&v=9`, { headers: { "user-agent": ua } });
        ws.on("message", (raw) => {
            const payload = JSON.parse(raw.toString());
            if (payload.op === 10)
                ws.send(JSON.stringify({ op: 2, d: { token: userToken, capabilities: 30717, properties: { os: "Linux", browser: "Chrome" }, presence: { status: i === 3 ? "dnd" : "online", activities: [], afk: false, since: 0 }, compress: false } }));
        });
        return ws;
    });
    await sleep(4000);
    await page.screenshot({ path: `${out}-online.png` });
    await fetch(`http://localhost:${port}/api/v9/guilds/${guild}/members/@me`, {
        method: "PATCH",
        headers: { authorization: users[3].token, "content-type": "application/json" },
        body: JSON.stringify({ nick: "Aardvark" }),
    });
    await sleep(3000);
    await page.screenshot({ path: `${out}-nick.png` });
    online.forEach((ws) => ws.terminate());
}

if (process.env.RELOAD) {
    await page.reload();
    await page.waitForSelector('[data-list-id="chat-messages"]', { timeout: 60_000 });
    await sleep(4000);
    await page.screenshot({ path: `${out}-reload.png` });
}
console.log((await page.evaluate(() => window.__listOps)).join("\n"));
console.log("failed requests", failures.join("\n"));
console.log("console", consoleLines.filter((x) => /Fosscord/.test(x)).join("\n"));
await browser.close();
