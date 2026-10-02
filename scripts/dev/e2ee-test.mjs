import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const port = process.env.PORT || "3120";
const api = `http://localhost:${port}/api/v9`;
const origin = `http://fosscord.localhost:${port}`;
const database = Object.fromEntries(
    readFileSync(new URL("../../.env", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
).DATABASE;
const FALLBACK = "🔒 Encrypted message";
const profiles = mkdtempSync(join(tmpdir(), "fosscord-e2ee-"));
const started = Date.now();
const shots = process.env.E2EE_SHOTS;
const shot = (s, name) => shots && s.page.screenshot({ path: join(shots, `${name}.png`) });
const log = (...args) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...args);

const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token && { authorization: token }) },
        body: body && JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};

const sql = (query) => execFileSync("psql", [database, "-At", "-c", query], { encoding: "utf8" }).trim();

const suffix = randomBytes(4).toString("hex");
const accountsFile = new URL("./.e2ee-test-accounts", import.meta.url);
const saved = existsSync(accountsFile) ? JSON.parse(readFileSync(accountsFile, "utf8")) : {};
const account = async (name) => {
    const known = saved[name];
    if (known) {
        const login = await call("POST", "/auth/login", null, { login: known.email, password: known.password });
        if (login.body?.token) return { name, token: login.body.token, id: login.body.user_id ?? (await call("GET", "/users/@me", login.body.token)).body.id };
    }
    const email = `e2ee-${name}-${suffix}@fosscord.test`;
    const password = randomBytes(12).toString("hex");
    const res = await call("POST", "/auth/register", null, { email, username: `e2ee${name}${suffix}`, password, date_of_birth: "2000-01-01", consent: true });
    assert.ok(res.body?.token, `register ${name}: ${JSON.stringify(res.body)}`);
    saved[name] = { email, password };
    writeFileSync(accountsFile, JSON.stringify(saved));
    return { name, token: res.body.token, id: (await call("GET", "/users/@me", res.body.token)).body.id };
};

const alice = await account("alice");
const bob = await account("bob");
await call("PUT", `/users/@me/relationships/${bob.id}`, alice.token, {});
await call("PUT", `/users/@me/relationships/${alice.id}`, bob.token, {});
const dm = (await call("POST", "/users/@me/channels", alice.token, { recipients: [bob.id] })).body;
assert.ok(dm?.id, "dm channel");
assert.equal((await call("POST", "/users/@me/channels", bob.token, { recipients: [alice.id] })).body?.id, dm.id, "bob opens the same dm");
sql(
    `delete from e2ee_devices where user_id in ('${alice.id}', '${bob.id}'); delete from e2ee_identities where user_id in ('${alice.id}', '${bob.id}'); delete from messages where channel_id = '${dm.id}'; update channels set e2ee_enabled_at = null where id = '${dm.id}'`,
);
log(`users ${alice.id} and ${bob.id}, dm ${dm.id}, e2ee state reset`);

const launch = async (user, extraInit) => {
    const context = await chromium.launchPersistentContext(join(profiles, user.name), {
        channel: "chrome",
        headless: true,
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark",
    });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), user.token);
    if (extraInit) await context.addInitScript(extraInit);
    const page = context.pages()[0] ?? (await context.newPage());
    const sent = [];
    const errors = [];
    page.on("console", (m) => m.text().startsWith("[e2ee]") && errors.push(m.text()));
    page.on("request", (r) => ["POST", "PATCH"].includes(r.method()) && r.url().includes(`/channels/${dm.id}/messages`) && sent.push(r.postDataJSON()));
    await page.goto(`${origin}/channels/@me/${dm.id}`);
    return { context, page, sent, errors, user };
};

const status = (s) => s.page.evaluate(() => window.__fosscordE2ee?.status?.());
const waitReady = (s) => s.page.waitForFunction(() => window.__fosscordE2ee?.status?.()?.ready === true, null, { timeout: 20000 });
const waitEncrypted = (s) => s.page.waitForFunction((id) => window.__fosscordE2ee?.status?.()?.encryptedChannels.includes(id), dm.id, { timeout: 10000 });
const send = async (s, text) => {
    const box = s.page.locator('[role="textbox"]').first();
    await box.click();
    await s.page.keyboard.type(text);
    await s.page.keyboard.press("Enter");
};
const waitDecrypted = (s, text) =>
    s.page.waitForFunction(
        (text) => [...document.querySelectorAll('[id^="message-content-"]')].some((el) => el.textContent.includes(text) && el.querySelector('.fe2ee-lock[data-state="decrypted"]')),
        text,
        { timeout: 12000 },
    );
const close = async (...sessions) => Promise.all(sessions.map((s) => s.context.close().catch(() => {})));
const diagnose = async (...sessions) => {
    for (const s of sessions) {
        const state = await s.page
            .evaluate(() => ({
                status: window.__fosscordE2ee?.status?.(),
                banners: document.querySelector(".fe2ee-banners")?.innerText,
                messages: [...document.querySelectorAll('[id^="message-content-"]')].map((el) => el.id + ": " + el.textContent).slice(-5),
            }))
            .catch((e) => String(e));
        console.error(`--- ${s.user.name}`, JSON.stringify({ state, sent: s.sent, errors: s.errors }, null, 1).slice(0, 4000));
    }
};

const phase = async (name, fn) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            log(`${name}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
            return await fn();
        } catch (error) {
            const closed = /closed|disconnected|Target/i.test(String(error));
            if (!closed || attempt === 3) throw error;
            log(`browser went away, retrying: ${String(error).split("\n")[0]}`);
        }
    }
};

const first = `hello from alice ${suffix}`;
const second = `reply from bob ${suffix}`;
const edited = `edited by alice ${suffix}`;

try {
    await phase("both browsers register devices, alice turns encryption on and sends", async () => {
        const [a, b] = await Promise.all([launch(alice), launch(bob)]);
        try {
            await Promise.all([waitReady(a), waitReady(b)]);
            const [sa, sb] = await Promise.all([status(a), status(b)]);
            assert.equal(sa.linked, true, "alice device linked");
            assert.equal(sb.linked, true, "bob device linked");
            log(`alice device ${sa.deviceId}, bob device ${sb.deviceId}`);

            if (!sa.encryptedChannels.includes(dm.id)) {
                await a.page.locator(".fe2ee-toggle").click();
                await a.page.locator("dialog.fe2ee-dialog button", { hasText: "Turn on encryption" }).click();
            }
            await Promise.all([waitEncrypted(a), waitEncrypted(b)]);
            assert.equal(await a.page.locator(".fe2ee-toggle").getAttribute("aria-pressed"), "true", "header toggle shows encryption on");

            await send(a, first);
            await waitDecrypted(b, first);
            await waitDecrypted(a, first);
            await shot(b, "1-bob-reads-alice");
            assert.ok(a.sent.length >= 1, "alice sent a request");
            const body = a.sent.at(-1);
            assert.equal(body.content, FALLBACK, "request body carries only the fallback");
            assert.ok(!JSON.stringify(body).includes(first), "plaintext never leaves the browser");
            log("bob read alice's message decrypted");
            globalThis.sentEnvelope = body.encrypted;

            await a.page.locator('[role="textbox"]').first().click();
            await a.page.keyboard.press("ArrowUp");
            await a.page.locator('[role="textbox"]').nth(0).waitFor();
            await a.page.keyboard.press("ControlOrMeta+a");
            await a.page.keyboard.type(edited);
            await a.page.keyboard.press("Enter");
            await waitDecrypted(b, edited);
            log("bob read alice's edit decrypted");
            const edit = a.sent.at(-1);
            assert.equal(edit.content, FALLBACK, "edit carries only the fallback");
            assert.ok(edit.encrypted.mid, "edit envelope is bound to the message id");
            assert.ok(!JSON.stringify(edit).includes(edited), "edited plaintext never leaves the browser");
            globalThis.sentEnvelope = edit.encrypted;
            assert.deepEqual(a.errors, [], "alice has no e2ee errors");
            assert.deepEqual(b.errors, [], "bob has no e2ee errors");
        } catch (error) {
            await diagnose(a, b);
            throw error;
        } finally {
            await close(a, b);
        }
    });

    await phase("server stores only the fallback and the envelope round-trips", async () => {
        const history = (await call("GET", `/channels/${dm.id}/messages?limit=5`, bob.token)).body;
        const message = history.find((m) => m.encrypted);
        assert.ok(message, "encrypted message in history");
        assert.equal(message.content, FALLBACK);
        assert.deepEqual(message.encrypted, globalThis.sentEnvelope, "REST envelope equals the envelope the browser sent");
        const row = JSON.parse(sql(`select json_build_object('content', content, 'encrypted', encrypted, 'flags', flags) from messages where id = '${message.id}'`));
        assert.equal(row.content, FALLBACK, "database content is the fallback string");
        assert.deepEqual(row.encrypted, globalThis.sentEnvelope, "database envelope equals the sent envelope");
        assert.equal(row.flags & 4, 4, "suppress embeds flag set");
        assert.equal(
            sql(`select count(*) from messages where channel_id = '${dm.id}' and (content like '%${suffix}%' or encrypted::text like '%${suffix}%')`),
            "0",
            "plaintext is nowhere in the database",
        );
        assert.equal(new Set(message.encrypted.keys.map((k) => k.user_id)).size, 2, "content key wrapped for both users");

        const plain = await call("POST", `/channels/${dm.id}/messages`, alice.token, { content: "plaintext attempt" });
        assert.equal(plain.status, 400, "plaintext rejected");
        assert.equal(plain.body.message, "E2EE_REQUIRED");
        const { mid, ...created } = globalThis.sentEnvelope;
        const partial = { ...created, keys: created.keys.slice(0, 1) };
        const mismatch = await call("POST", `/channels/${dm.id}/messages`, alice.token, { content: FALLBACK, nonce: `${Date.now()}`, encrypted: partial });
        assert.equal(mismatch.status, 409, "envelope skipping a device is rejected");
        assert.equal(mismatch.body.message, "E2EE_DEVICE_MISMATCH");
        const disable = await call("PUT", `/channels/${dm.id}/e2ee`, alice.token, { enabled: false });
        assert.equal(disable.body.message, "E2EE_CANNOT_DISABLE", "encryption can't be turned off");
        log("server checks passed");
    });

    await phase("history decrypts after reload, bob replies, safety numbers match", async () => {
        const [a, b] = await Promise.all([launch(alice), launch(bob)]);
        try {
            await Promise.all([waitReady(a), waitReady(b)]);
            await waitDecrypted(b, edited);
            await send(b, second);
            await waitDecrypted(a, second);
            log("alice read bob's reply decrypted, history decrypted for bob");

            const numbers = [];
            for (const s of [a, b]) {
                await s.page.locator(".fe2ee-toggle").click();
                const digits = s.page.locator("dialog.fe2ee-dialog .fe2ee-digits").first();
                await s.page.waitForFunction(() => /^\d{60}$/.test(document.querySelector("dialog.fe2ee-dialog .fe2ee-digits")?.dataset.number ?? ""), null, { timeout: 8000 });
                await shot(s, `2-safety-${s.user.name}`);
                numbers.push(await digits.getAttribute("data-number"));
                await s.page.locator("dialog.fe2ee-dialog button", { hasText: "Mark as verified" }).click();
                await s.page.locator("dialog.fe2ee-dialog .fe2ee-status", { hasText: "Verified" }).waitFor({ timeout: 5000 });
                await s.page.locator("dialog.fe2ee-dialog button", { hasText: "Close" }).click();
            }
            assert.equal(numbers[0], numbers[1], "both sides compute the same safety number");
            log(`safety number ${numbers[0].match(/\d{5}/g).join(" ")}`);
        } catch (error) {
            await diagnose(a, b);
            throw error;
        } finally {
            await close(a, b);
        }
    });

    await phase("a broken crypto runtime fails closed", async () => {
        const breakX25519 = () => {
            const generate = crypto.subtle.generateKey.bind(crypto.subtle);
            crypto.subtle.generateKey = (alg, ...rest) => ((alg?.name ?? alg) === "X25519" ? Promise.reject(new Error("X25519 disabled for test")) : generate(alg, ...rest));
        };
        const a = await launch(alice, breakX25519);
        try {
            await a.page.locator(".fe2ee-banner[data-id='failure']").waitFor({ timeout: 20000 });
            const text = await a.page.locator(".fe2ee-banner[data-id='failure']").innerText();
            assert.match(text, /unavailable/);
            await shot(a, "3-self-test-banner");
            const before = (await call("GET", `/channels/${dm.id}/messages?limit=1`, alice.token)).body[0].id;
            await send(a, `should never be sent ${suffix}`);
            await a.page.waitForTimeout(2500);
            const after = (await call("GET", `/channels/${dm.id}/messages?limit=1`, alice.token)).body[0].id;
            assert.equal(after, before, "nothing was sent while the self-test failed");
            assert.ok(!a.sent.some((b) => JSON.stringify(b).includes("should never be sent")), "no plaintext request left the browser");
            log("self-test banner shown and sending refused");
        } catch (error) {
            await diagnose(a);
            throw error;
        } finally {
            await close(a);
        }
    });

    log("all e2ee checks passed");
} finally {
    rmSync(profiles, { recursive: true, force: true });
}
