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
const seedFile = new URL("./.test-account", import.meta.url);
if (existsSync(seedFile)) {
    const seed = Object.fromEntries(
        readFileSync(seedFile, "utf8")
            .trim()
            .split("\n")
            .map((l) => l.split("=")),
    );
    saved.tester ??= { email: seed.TEST_EMAIL, password: seed.TEST_PASSWORD };
    saved.friend ??= { email: "friend@fosscord.test", password: seed.FRIEND_PASSWORD };
}
const account = async (name) => {
    const known = saved[name];
    if (known) {
        const login = await call("POST", "/auth/login", null, { login: known.email, password: known.password });
        if (login.body?.token)
            return { name, email: known.email, password: known.password, token: login.body.token, id: login.body.user_id ?? (await call("GET", "/users/@me", login.body.token)).body.id };
    }
    const email = `e2ee-${name}-${suffix}@fosscord.test`;
    const password = randomBytes(12).toString("hex");
    const res = await call("POST", "/auth/register", null, { email, username: `e2ee${name}${suffix}`, password, date_of_birth: "2000-01-01", consent: true });
    assert.ok(res.body?.token, `register ${name}: ${JSON.stringify(res.body)}`);
    saved[name] = { email, password };
    writeFileSync(accountsFile, JSON.stringify(saved));
    return { name, email, password, token: res.body.token, id: (await call("GET", "/users/@me", res.body.token)).body.id };
};

const tester = await account("tester");
const friend = await account("friend");
await call("PUT", `/users/@me/relationships/${friend.id}`, tester.token, {});
await call("PUT", `/users/@me/relationships/${tester.id}`, friend.token, {});
const dm = (await call("POST", "/users/@me/channels", tester.token, { recipients: [friend.id] })).body;
assert.ok(dm?.id, "dm channel");
assert.equal((await call("POST", "/users/@me/channels", friend.token, { recipients: [tester.id] })).body?.id, dm.id, "friend opens the same dm");
sql(
    `delete from e2ee_devices where user_id in ('${tester.id}', '${friend.id}'); delete from e2ee_identities where user_id in ('${tester.id}', '${friend.id}'); delete from e2ee_key_backups where user_id in ('${tester.id}', '${friend.id}'); delete from e2ee_backup_keys where user_id in ('${tester.id}', '${friend.id}'); delete from messages where channel_id = '${dm.id}' and encrypted is not null; update channels set e2ee_enabled_at = null where id = '${dm.id}'`,
);
log(`users ${tester.id} and ${friend.id}, dm ${dm.id}, e2ee state reset`);

const launch = async (user, options = {}) => {
    const context = await chromium.launchPersistentContext(join(profiles, options.profile ?? user.name), {
        channel: "chrome",
        headless: true,
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark",
    });
    try {
        return await open(context, user, options);
    } catch (error) {
        await context.close().catch(() => {});
        throw error;
    }
};

const launchAll = async (...specs) => {
    const results = await Promise.allSettled(specs.map(([user, options]) => launch(user, options)));
    const failed = results.find((r) => r.status === "rejected");
    if (!failed) return results.map((r) => r.value);
    await Promise.all(results.filter((r) => r.status === "fulfilled").map((r) => r.value.context.close().catch(() => {})));
    throw failed.reason;
};

const open = async (context, user, { login = false, extraInit } = {}) => {
    if (login)
        await context.addInitScript((nonce) => {
            if (sessionStorage.getItem("e2ee-test-cleared") === nonce) return;
            sessionStorage.setItem("e2ee-test-cleared", nonce);
            localStorage.clear();
        }, randomBytes(8).toString("hex"));
    else await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), user.token);
    if (extraInit) await context.addInitScript(extraInit);
    const page = context.pages()[0] ?? (await context.newPage());
    const sent = [];
    const errors = [];
    page.on("console", (m) => m.text().startsWith("[e2ee]") && errors.push(m.text()));
    page.on("request", (r) => ["POST", "PATCH"].includes(r.method()) && r.url().includes(`/channels/${dm.id}/messages`) && sent.push(r.postDataJSON()));
    if (!login) {
        await page.goto(`${origin}/channels/@me/${dm.id}`);
        return { context, page, sent, errors, user };
    }
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(user.email, { timeout: 20000 });
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('button[type="submit"]').click();
    const link = page.locator(`a[href="/channels/@me/${dm.id}"]`).first();
    await link.waitFor({ timeout: 20000 });
    const unlock = page.locator("dialog.fe2ee-dialog[open]");
    let askedToUnlock = false;
    for (let i = 0; i < 40 && !page.url().endsWith(dm.id); i++) {
        if (await unlock.count()) {
            askedToUnlock = true;
            await unlock.locator("button", { hasText: "Not now" }).click({ timeout: 2000 }).catch(() => {});
        } else await link.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(250);
    }
    return { context, page, sent, errors, user, askedToUnlock };
};

const dialogOpen = (s) => s.page.locator("dialog.fe2ee-dialog[open]").count();
const backupRow = () => JSON.parse(sql(`select row_to_json(b) from e2ee_key_backups b where user_id = '${tester.id}'`) || "null");
const waitFor = async (what, check, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
};

const status = (s) => s.page.evaluate(() => window.__fosscordE2ee?.status?.());
const waitReady = (s) => s.page.waitForFunction(() => window.__fosscordE2ee?.status?.()?.ready === true, null, { timeout: 30000 });
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
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            log(`${name}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
            return await fn();
        } catch (error) {
            const closed = /closed|disconnected|Target|Timeout/i.test(String(error));
            if (!closed || attempt === 5) throw error;
            log(`browser went away, retrying: ${String(error).split("\n")[0]}`);
        }
    }
};

const originalPassword = tester.password;
let profiled = 0;
const fresh = (name) => `${name}-${++profiled}`;
let profileB = "";
const first = `hello from tester ${suffix}`;
const second = `reply from friend ${suffix}`;
const edited = `edited by tester ${suffix}`;
const fromNewBrowser = `sent from a new browser ${suffix}`;
const afterRotation = `after rotation from friend ${suffix}`;

try {
    await phase("tester logs in through the login form and gets a password backup", async () => {
        const a = await launch(tester, { login: true });
        try {
            await waitReady(a);
            const sa = await status(a);
            assert.equal(sa.linked, true, "tester device linked");
            assert.deepEqual(sa.backup && { mode: sa.backup.mode, hasSecret: sa.backup.hasSecret }, { mode: "password", hasSecret: true }, "login created a password backup");
            assert.equal(a.askedToUnlock, false, "the first device never asks to unlock");
        } catch (error) {
            await diagnose(a);
            throw error;
        } finally {
            await close(a);
        }
    });

    await phase("both browsers register devices, tester turns encryption on and sends", async () => {
        const [a, b] = await launchAll([tester], [friend]);
        try {
            await Promise.all([waitReady(a), waitReady(b)]);
            const [sa, sb] = await Promise.all([status(a), status(b)]);
            assert.equal(sa.linked, true, "tester device linked");
            assert.equal(sb.linked, true, "friend device linked");
            log(`tester device ${sa.deviceId}, friend device ${sb.deviceId}`);

            if (!sa.encryptedChannels.includes(dm.id)) {
                await a.page.locator(".fe2ee-toggle").click();
                await a.page.locator("dialog.fe2ee-dialog button", { hasText: "Turn on encryption" }).click();
            }
            await Promise.all([waitEncrypted(a), waitEncrypted(b)]);
            assert.equal(await a.page.locator(".fe2ee-toggle").getAttribute("aria-pressed"), "true", "header toggle shows encryption on");

            await send(a, first);
            await waitDecrypted(b, first);
            await waitDecrypted(a, first);
            await shot(b, "1-friend-reads-tester");
            assert.ok(a.sent.length >= 1, "tester sent a request");
            const body = a.sent.at(-1);
            assert.equal(body.content, FALLBACK, "request body carries only the fallback");
            assert.ok(!JSON.stringify(body).includes(first), "plaintext never leaves the browser");
            log("friend read tester's message decrypted");
            globalThis.sentEnvelope = body.encrypted;

            await a.page.locator('[role="textbox"]').first().click();
            await a.page.keyboard.press("ArrowUp");
            await a.page.locator('[role="textbox"]').nth(0).waitFor();
            await a.page.keyboard.press("ControlOrMeta+a");
            await a.page.keyboard.type(edited);
            await a.page.keyboard.press("Enter");
            await waitDecrypted(b, edited);
            log("friend read tester's edit decrypted");
            const edit = a.sent.at(-1);
            assert.equal(edit.content, FALLBACK, "edit carries only the fallback");
            assert.ok(edit.encrypted.mid, "edit envelope is bound to the message id");
            assert.ok(!JSON.stringify(edit).includes(edited), "edited plaintext never leaves the browser");
            globalThis.sentEnvelope = edit.encrypted;
            assert.deepEqual(a.errors, [], "tester has no e2ee errors");
            assert.deepEqual(b.errors, [], "friend has no e2ee errors");
        } catch (error) {
            await diagnose(a, b);
            throw error;
        } finally {
            await close(a, b);
        }
    });

    await phase("server stores only the fallback and the envelope round-trips", async () => {
        const history = (await call("GET", `/channels/${dm.id}/messages?limit=5`, friend.token)).body;
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
        assert.deepEqual(message.encrypted.backup.map((k) => k.user_id).sort(), [tester.id, friend.id].sort(), "content key wrapped to both users' backup keys");
        const backup = JSON.parse(sql(`select row_to_json(b) from e2ee_key_backups b where user_id = '${tester.id}'`));
        assert.equal(backup.mode, "password");
        assert.deepEqual(backup.kdf, { name: "argon2id", memory: 65536, iterations: 3, parallelism: 1 }, "argon2id with 64 MiB and 3 iterations");
        assert.ok(backup.wrapped_secret, "backup secret is wrapped under the password");
        assert.ok(!JSON.stringify(backup).includes(tester.password), "the password is not stored");
        const others = await call("GET", "/users/@me/e2ee/backup", friend.token);
        assert.notEqual(others.body?.identity_key, backup.identity_key, "the backup endpoint only returns the caller's own backup");

        const plain = await call("POST", `/channels/${dm.id}/messages`, tester.token, { content: "plaintext attempt" });
        assert.equal(plain.status, 400, "plaintext rejected");
        assert.equal(plain.body.message, "E2EE_REQUIRED");
        const { mid, ...created } = globalThis.sentEnvelope;
        const partial = { ...created, keys: created.keys.slice(0, 1) };
        const mismatch = await call("POST", `/channels/${dm.id}/messages`, tester.token, { content: FALLBACK, nonce: `${Date.now()}`, encrypted: partial });
        assert.equal(mismatch.status, 409, "envelope skipping a device is rejected");
        assert.equal(mismatch.body.message, "E2EE_DEVICE_MISMATCH");
        const disable = await call("PUT", `/channels/${dm.id}/e2ee`, tester.token, { enabled: false });
        assert.equal(disable.body.message, "E2EE_CANNOT_DISABLE", "encryption can't be turned off");
        log("server checks passed");
    });

    await phase("history decrypts after reload, friend replies, safety numbers match", async () => {
        const [a, b] = await launchAll([tester], [friend]);
        try {
            await Promise.all([waitReady(a), waitReady(b)]);
            await waitDecrypted(b, edited);
            await send(b, second);
            await waitDecrypted(a, second);
            log("tester read friend's reply decrypted, history decrypted for friend");

            const numbers = [];
            for (const s of [a, b]) {
                await s.page.locator(".fe2ee-toggle").click();
                const digits = s.page.locator("dialog.fe2ee-dialog .fe2ee-digits").first();
                await s.page.waitForFunction(() => /^\d{60}$/.test(document.querySelector("dialog.fe2ee-dialog .fe2ee-digits")?.dataset.number ?? ""), null, { timeout: 8000 });
                await shot(s, `2-safety-${s.user.name}`);
                numbers.push(await digits.getAttribute("data-number"));
                const verify = s.page.locator("dialog.fe2ee-dialog button", { hasText: "Mark as verified" });
                if (await verify.count()) await verify.click();
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

    await phase("a fresh browser reads the history after logging in, with no prompts", async () => {
        profileB = fresh("tester-b");
        const c = await launch(tester, { login: true, profile: profileB });
        try {
            await waitReady(c);
            const sc = await status(c);
            assert.equal(sc.linked, true, "the new browser unlocked itself from the password backup");
            assert.equal(sc.holdsIdentity, true, "the new browser restored the identity key");
            await waitDecrypted(c, edited);
            await waitDecrypted(c, second);
            assert.equal(c.askedToUnlock, false, "no unlock prompt while logging in");
            assert.equal(await dialogOpen(c), 0, "no unlock prompt after logging in");
            await shot(c, "4-new-browser-history");
            log("new browser read the history");
        } catch (error) {
            await diagnose(c);
            throw error;
        } finally {
            await close(c);
        }
    });

    await phase("the new browser sends", async () => {
        const c = await launch(tester, { profile: profileB });
        try {
            await waitReady(c);
            if (!(await c.page.locator('[id^="message-content-"]', { hasText: fromNewBrowser }).count())) await send(c, fromNewBrowser);
            await waitDecrypted(c, fromNewBrowser);
        } catch (error) {
            await diagnose(c);
            throw error;
        } finally {
            await close(c);
        }
    });

    await phase("friend still reads everything", async () => {
        const b = await launch(friend);
        try {
            await waitReady(b);
            await waitDecrypted(b, fromNewBrowser);
            await waitDecrypted(b, edited);
            await waitDecrypted(b, second);
            log("friend read the new browser's message and the history");
        } catch (error) {
            await diagnose(b);
            throw error;
        } finally {
            await close(b);
        }
    });

    await phase("an identity without a backup gets one on the next login and history is backfilled", async () => {
        sql(`delete from e2ee_backup_keys where user_id = '${tester.id}'; delete from e2ee_key_backups where user_id = '${tester.id}'`);
        const before = sql(`select public_key from e2ee_identities where user_id = '${tester.id}'`);
        const total = Number(sql(`select count(*) from messages where channel_id = '${dm.id}' and encrypted is not null`));
        const a = await launch(tester, { login: true });
        try {
            await waitReady(a);
            await waitFor("the new backup", () => backupRow()?.wrapped_secret);
            const after = sql(`select public_key from e2ee_identities where user_id = '${tester.id}'`);
            assert.notEqual(after, before, "the non-exportable identity was rotated");
            assert.equal(sql(`select previous_key from e2ee_identities where user_id = '${tester.id}'`), before, "the rotation is chained to the old identity");
            await waitFor("backfilled message keys", () => Number(sql(`select count(*) from e2ee_backup_keys where user_id = '${tester.id}'`)) >= total);
            log(`identity rotated and ${total} message keys backfilled`);
        } catch (error) {
            await diagnose(a);
            throw error;
        } finally {
            await close(a);
        }
    });

    await phase("friend trusts the rotated identity without a warning", async () => {
        const b = await launch(friend);
        try {
            await waitReady(b);
            if (!(await b.page.locator('[id^="message-content-"]', { hasText: afterRotation }).count())) await send(b, afterRotation);
            await waitDecrypted(b, afterRotation);
            await b.page.locator(".fe2ee-toggle").click();
            await b.page.locator("dialog.fe2ee-dialog .fe2ee-status", { hasText: "Verified" }).waitFor({ timeout: 8000 });
            assert.equal(await b.page.locator(".fe2ee-banner[data-id='changed']").count(), 0, "friend sees no safety number warning after the signed rotation");
            log("friend still trusts tester after the rotation");
        } catch (error) {
            await diagnose(b);
            throw error;
        } finally {
            await close(b);
        }
    });

    await phase("another fresh browser reads the backfilled history", async () => {
        const d = await launch(tester, { login: true, profile: fresh("tester-d") });
        try {
            await waitReady(d);
            await waitDecrypted(d, edited);
            await waitDecrypted(d, second);
            await waitDecrypted(d, afterRotation);
            assert.equal(await dialogOpen(d), 0, "no unlock prompt");
            log("another fresh browser read the backfilled history");
        } catch (error) {
            await diagnose(d);
            throw error;
        } finally {
            await close(d);
        }
    });

    await phase("a password change rewraps the backup and a browser that logs in with the new password reads everything", async () => {
        const before = backupRow();
        const next = randomBytes(12).toString("hex");
        const a = await launch(tester);
        try {
            await waitReady(a);
            assert.equal((await status(a)).hasSecret, true);
            const token = await a.page.evaluate(
                async ({ previous, next }) => {
                    const req = window.__fosscordE2ee.reqs.filter((r) => r.c).sort((x, y) => Object.keys(y.c).length - Object.keys(x.c).length)[0];
                    const values = Object.values(req.c).flatMap((m) => {
                        try {
                            return Object.values(m.exports ?? {});
                        } catch {
                            return [];
                        }
                    });
                    const http = values.find((v) => v && typeof v === "object" && typeof v.patch === "function" && String(v.patch).includes("AUTH_URL"));
                    const res = await http.patch({ url: "/users/@me", body: { password: previous, new_password: next }, rejectWithError: false });
                    return res.body.token;
                },
                { previous: tester.password, next },
            );
            assert.ok(token, "password change returned a token");
            tester.password = next;
            tester.token = token;
            await waitFor("the rewrapped backup", () => backupRow()?.version > before.version, 20000);
            const after = backupRow();
            assert.notEqual(after.salt, before.salt, "a new salt");
            assert.notEqual(after.wrapped_secret, before.wrapped_secret, "the secret was rewrapped");
            assert.equal(after.backup_public_key, before.backup_public_key, "the backup keypair stays, so message keys need no rewrap");
            log("password changed and backup rewrapped");
        } catch (error) {
            await diagnose(a);
            throw error;
        } finally {
            await close(a);
        }
    });

    await phase("browser C logs in with the new password and reads everything", async () => {
        const c = await launch(tester, { login: true, profile: fresh("tester-c") });
        try {
            await waitReady(c);
            assert.equal((await status(c)).linked, true, "the new password unlocked the backup");
            await waitDecrypted(c, edited);
            await waitDecrypted(c, afterRotation);
            assert.equal(await dialogOpen(c), 0, "no unlock prompt");
            log("browser C logged in with the new password and read the history");
        } catch (error) {
            await diagnose(c);
            throw error;
        } finally {
            await close(c);
        }
    });

    let recoveryCode = "";
    await phase("recovery-code mode asks a new browser for the code", async () => {
        const a = await launch(tester);
        try {
            await waitReady(a);
            await a.page.locator(".fe2ee-toggle").click();
            await a.page.locator("dialog.fe2ee-dialog button", { hasText: "Encryption settings" }).click();
            await a.page.locator("dialog.fe2ee-dialog button", { hasText: "Use a recovery code instead" }).click();
            await a.page.locator("dialog.fe2ee-dialog button", { hasText: "Make recovery code" }).click();
            const box = a.page.locator("dialog.fe2ee-dialog .fe2ee-recovery");
            await box.waitFor({ timeout: 10000 });
            recoveryCode = await box.getAttribute("data-code");
            await shot(a, "5-recovery-code");
            await a.page.locator("dialog.fe2ee-dialog button", { hasText: "I saved it" }).click();
            assert.match(recoveryCode, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
            const row = backupRow();
            assert.equal(row.mode, "recovery");
            assert.equal(row.kdf.name, "hkdf-sha256");
            log("switched to a recovery code");
        } catch (error) {
            await diagnose(a);
            throw error;
        } finally {
            await close(a);
        }
    });

    await phase("a new browser asks for the recovery code and the history fills in", async () => {
        const e = await launch(tester, { login: true, profile: fresh("tester-e") });
        try {
            await waitReady(e);
            assert.equal((await status(e)).locked, true, "the password alone doesn't unlock a recovery-code backup");
            const missing = e.page.locator('[id^="message-content-"]', { hasText: "Sent before this browser was set up" }).first();
            await missing.waitFor({ timeout: 12000 });
            await shot(e, "6-missing-keys");
            if (!(await dialogOpen(e))) await missing.locator(".fe2ee-unlock").click();
            const input = e.page.getByLabel("Recovery code");
            await input.fill("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH");
            await e.page.locator("dialog.fe2ee-dialog button", { hasText: /^Unlock$/ }).click();
            await e.page.locator("dialog.fe2ee-dialog .fe2ee-error", { hasText: "recovery code" }).waitFor({ timeout: 8000 });
            await shot(e, "7-recovery-prompt");
            await input.fill(recoveryCode.toLowerCase().replace(/-/g, " "));
            await e.page.locator("dialog.fe2ee-dialog button", { hasText: /^Unlock$/ }).click();
            await waitDecrypted(e, edited);
            await waitDecrypted(e, afterRotation);
            assert.equal((await status(e)).linked, true);
            log("the recovery code unlocked a new browser and the history filled in");
        } catch (error) {
            await diagnose(e);
            throw error;
        } finally {
            await close(e);
        }
    });

    await phase("a signed-in browser approves a new login", async () => {
        const [a, f] = await launchAll([tester], [tester, { login: true, profile: fresh("tester-f") }]);
        try {
            await waitReady(a);
            try {
                await waitReady(f);
                assert.equal((await status(f)).locked, true, "the new browser starts locked");
                const prompt = a.page.locator("dialog.fe2ee-dialog", { hasText: "New login on" });
                await prompt.waitFor({ timeout: 15000 });
                const codeA = (await prompt.locator(".fe2ee-code").innerText()).trim();
                if (!(await dialogOpen(f))) await f.page.locator(".fe2ee-banner[data-id='linked'] button").click();
                const codeF = f.page.locator("dialog.fe2ee-dialog .fe2ee-code");
                await f.page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector("dialog.fe2ee-dialog .fe2ee-code")?.textContent ?? ""), null, { timeout: 8000 });
                assert.equal((await codeF.innerText()).trim(), codeA, "both browsers show the same code");
                await shot(a, "8-approve-prompt");
                await shot(f, "9-approve-waiting");
                await prompt.locator("button", { hasText: "Approve login" }).click();
                await f.page.waitForFunction(() => window.__fosscordE2ee?.status?.()?.linked === true, null, { timeout: 15000 });
                await waitDecrypted(f, edited);
                await waitDecrypted(f, fromNewBrowser);
                assert.equal(await dialogOpen(f), 0, "the unlock dialog closed by itself");
                log(`approved the new browser with code ${codeA}`);
            } catch (error) {
                await diagnose(a, f);
                throw error;
            } finally {
                await close(f);
            }
        } finally {
            await close(a);
        }
    });

    await phase("a broken crypto runtime fails closed", async () => {
        const breakX25519 = () => {
            const generate = crypto.subtle.generateKey.bind(crypto.subtle);
            crypto.subtle.generateKey = (alg, ...rest) => ((alg?.name ?? alg) === "X25519" ? Promise.reject(new Error("X25519 disabled for test")) : generate(alg, ...rest));
        };
        const a = await launch(tester, { extraInit: breakX25519 });
        try {
            await a.page.locator(".fe2ee-banner[data-id='failure']").waitFor({ timeout: 20000 });
            const text = await a.page.locator(".fe2ee-banner[data-id='failure']").innerText();
            assert.match(text, /unavailable/);
            await shot(a, "3-self-test-banner");
            const before = (await call("GET", `/channels/${dm.id}/messages?limit=1`, tester.token)).body[0].id;
            await send(a, `should never be sent ${suffix}`);
            await a.page.waitForTimeout(2500);
            const after = (await call("GET", `/channels/${dm.id}/messages?limit=1`, tester.token)).body[0].id;
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
    if (tester.password !== originalPassword) {
        const login = await call("POST", "/auth/login", null, { login: tester.email, password: tester.password });
        await call("PATCH", "/users/@me", login.body?.token, { password: tester.password, new_password: originalPassword });
    }
    try {
        rmSync(profiles, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (error) {
        console.error(`couldn't remove ${profiles}: ${error.code}`);
    }
}
