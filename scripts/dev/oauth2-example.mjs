import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const port = process.env.PORT || "3001";
const api = `http://localhost:${port}/api/v9`;
const origin = `http://fosscord.localhost:${port}`;
const browserPath = process.env.CHROME_PATH || "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

const call = async (method, path, { token, json, form, basic } = {}) => {
    const headers = {};
    if (token) headers.authorization = token;
    if (basic) headers.authorization = `Basic ${Buffer.from(`${basic[0]}:${basic[1]}`).toString("base64")}`;
    if (json) headers["content-type"] = "application/json";
    if (form) headers["content-type"] = "application/x-www-form-urlencoded";
    const res = await fetch(`${api}${path}`, { method, headers, body: json ? JSON.stringify(json) : form && new URLSearchParams(form) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};

const userToken = await (async () => {
    if (process.env.TOKEN) return process.env.TOKEN;
    const account = Object.fromEntries(
        readFileSync(new URL("./.test-account", import.meta.url), "utf8")
            .split("\n")
            .filter((line) => line.includes("="))
            .map((line) => line.split("=")),
    );
    const login = await call("POST", "/auth/login", { json: { login: account.TEST_EMAIL, password: account.TEST_PASSWORD } });
    assert.ok(login.body?.token, `login failed: ${JSON.stringify(login.body)}`);
    return login.body.token;
})();

let resolveCallback;
const callbackHit = new Promise((resolve) => (resolveCallback = resolve));
const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/callback") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/plain" }).end("authorized, you can close this tab");
    resolveCallback(url.searchParams);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const redirectUri = `http://localhost:${server.address().port}/callback`;

const app = (await call("POST", "/applications", { token: userToken, json: { name: `OAuth2 Example ${randomBytes(2).toString("hex")}` } })).body;
assert.ok(app?.id, "application created");
await call("PATCH", `/applications/${app.id}`, { token: userToken, json: { redirect_uris: [redirectUri] } });
const { secret } = (await call("POST", `/applications/${app.id}/reset`, { token: userToken, json: {} })).body;
console.log(`application ${app.id}, redirect ${redirectUri}`);

const verifier = randomBytes(48).toString("base64url");
const state = randomBytes(8).toString("hex");
const authorizeUrl = new URL(`${origin}/oauth2/authorize`);
authorizeUrl.search = new URLSearchParams({
    client_id: app.id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "identify email guilds guilds.members.read connections",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
}).toString();

const browser = await chromium.launch({ executablePath: browserPath, headless: process.env.HEADED !== "1" });
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), userToken);
    const page = await context.newPage();
    await page.goto(authorizeUrl.toString());
    await page.getByText("This will allow the developer").waitFor({ timeout: 30000 });
    const authorize = page.getByRole("button", { name: "Authorize" });
    while (!(await authorize.isVisible())) {
        await page.getByText("This will allow the developer").hover();
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(250);
    }
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    await authorize.click();
    const params = await Promise.race([callbackHit, new Promise((_, reject) => setTimeout(() => reject(new Error("no redirect to callback")), 20000))]);
    assert.equal(params.get("state"), state, "state round-trips");
    const code = params.get("code");
    assert.ok(code, "code returned");
    console.log("consent page redirected with a code");

    const exchange = await call("POST", "/oauth2/token", {
        form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier },
        basic: [app.id, secret],
    });
    assert.equal(exchange.status, 200, JSON.stringify(exchange.body));
    const { access_token, refresh_token, scope, token_type, expires_in } = exchange.body;
    console.log(`token: ${token_type}, scope "${scope}", expires in ${expires_in}s`);

    const me = await call("GET", "/users/@me", { token: `Bearer ${access_token}` });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    console.log(`GET /users/@me as bearer -> ${me.body.username} (${me.body.id}), email ${me.body.email}`);
    console.log(`GET /oauth2/@me -> scopes ${(await call("GET", "/oauth2/@me", { token: `Bearer ${access_token}` })).body.scopes.join(" ")}`);
    console.log(`GET /users/@me/guilds -> ${(await call("GET", "/users/@me/guilds", { token: `Bearer ${access_token}` })).body.length} guilds`);

    const refreshed = await call("POST", "/oauth2/token", { form: { grant_type: "refresh_token", refresh_token, client_id: app.id, client_secret: secret } });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.equal((await call("GET", "/users/@me", { token: `Bearer ${access_token}` })).status, 401, "old access token stops working after refresh");
    console.log("refresh rotated the access token");

    await call("POST", "/oauth2/token/revoke", { form: { token: refreshed.body.access_token, client_id: app.id, client_secret: secret } });
    assert.equal((await call("GET", "/users/@me", { token: `Bearer ${refreshed.body.access_token}` })).status, 401, "revoked token is rejected");
    console.log("revoked, bearer token now gets 401");
} finally {
    await browser.close();
    server.close();
    if (!process.env.KEEP_APP) await call("POST", `/applications/${app.id}/delete`, { token: userToken, json: {} });
}
