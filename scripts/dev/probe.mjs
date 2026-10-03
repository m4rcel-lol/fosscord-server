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
const path = args.find((a) => a.startsWith("/")) || "/channels/@me";
const wait = Number(flag("wait", "12")) * 1000;
const shot = flag("shot");
const evalSrc = flag("eval");
const as = flag("as", "tester");
const origin = process.env.ORIGIN || `http://fosscord.localhost:${port}`;

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);
const credentials = as === "friend" ? { login: "friend@fosscord.test", password: accounts.FRIEND_PASSWORD } : { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD };
const login = await fetch(`${process.env.ORIGIN || `http://localhost:${port}`}/api/v9/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) }).then((r) => r.json());
if (!login.token) throw new Error(`login failed: ${JSON.stringify(login)}`);

const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.addInitScript((token) => {
    localStorage.setItem("token", JSON.stringify(token));
}, login.token);
const page = await context.newPage();

const errors = [];
const failed = [];
const gateway = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 500)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 500)));
page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(origin, "")}`));
page.on("requestfailed", (r) => failed.push(`FAILED ${r.method()} ${r.url().replace(origin, "")} ${r.failure()?.errorText}`));
page.on("websocket", (ws) => ws.on("framereceived", (f) => typeof f.payload === "string" && gateway.push(f.payload.slice(0, 300))));

await page.goto(`${origin}${path}`);
await page.waitForTimeout(wait);
if (shot) await page.screenshot({ path: shot });

const result = {
    url: page.url().replace(origin, ""),
    title: await page.title(),
    text: (await page.evaluate(() => document.body.innerText)).slice(0, 2500),
    errors: [...new Set(errors)].slice(0, 30),
    failed: [...new Set(failed)].slice(0, 60),
};
if (evalSrc) result.eval = await page.evaluate(evalSrc);
if (args.includes("--gateway")) result.gateway = gateway.slice(0, 40);
console.log(JSON.stringify(result, null, 2));
await browser.close();
