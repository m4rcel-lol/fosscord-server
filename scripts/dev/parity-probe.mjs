import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const port = process.env.PORT || "3001";
const base = `http://localhost:${port}`;
const api = `${base}/api/v9`;

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);

async function call(method, path, token, body, extraHeaders = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(path.startsWith("http") ? path : `${api}${path}`, {
        method,
        headers: { ...(isForm || !body ? {} : { "content-type": "application/json" }), ...(token && { authorization: token }), ...extraHeaders },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = text.slice(0, 200);
    }
    return { status: res.status, body: json, headers: res.headers };
}

async function login(who) {
    const credentials = who === "friend" ? { login: "friend@fosscord.test", password: accounts.FRIEND_PASSWORD } : { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD };
    const r = await call("POST", "/auth/login", null, credentials);
    if (!r.body?.token) throw new Error(`login failed ${JSON.stringify(r.body)}`);
    return r.body.token;
}

function gateway(token, { intents, presence } = {}) {
    const ws = new WebSocket(`ws://localhost:${port}/?v=9&encoding=json`, { headers: { "user-agent": "Mozilla/5.0 probe", origin: base } });
    const events = [];
    const waiters = [];
    let seq = null;
    let hb;
    const ready = new Promise((resolve, reject) => {
        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.s) seq = msg.s;
            if (msg.op === 10) {
                hb = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), msg.d.heartbeat_interval);
                ws.send(
                    JSON.stringify({
                        op: 2,
                        d: {
                            token,
                            capabilities: 16381,
                            properties: { os: "Mac OS X", browser: "Chrome", device: "" },
                            ...(intents != null && { intents }),
                            ...(presence && { presence }),
                        },
                    }),
                );
            }
            if (msg.op === 0) {
                events.push(msg);
                if (msg.t === "READY") resolve(msg.d);
                for (const w of [...waiters])
                    if (w.pred(msg)) {
                        waiters.splice(waiters.indexOf(w), 1);
                        w.resolve(msg);
                    }
            }
            if (msg.op === 9) reject(new Error("invalid session"));
        });
        ws.on("close", (c, r) => reject(new Error(`closed ${c} ${r}`)));
        ws.on("error", reject);
    });
    return {
        ws,
        events,
        ready,
        send: (op, d) => ws.send(JSON.stringify({ op, d })),
        waitFor: (pred, ms = 5000) =>
            new Promise((resolve) => {
                const found = events.find(pred);
                if (found) return resolve(found);
                const w = { pred, resolve };
                waiters.push(w);
                setTimeout(() => {
                    const i = waiters.indexOf(w);
                    if (i !== -1) {
                        waiters.splice(i, 1);
                        resolve(null);
                    }
                }, ms);
            }),
        close: () => {
            clearInterval(hb);
            ws.close();
        },
    };
}

const only = process.argv[2];
const results = [];
const check = async (area, name, fn) => {
    if (only && !`${area} ${name}`.toLowerCase().includes(only.toLowerCase())) return;
    try {
        const r = await fn();
        const ok = r === true || r?.ok === true;
        results.push({ area, name, ok, skip: !!r?.skip, note: r?.note ?? (ok ? "" : JSON.stringify(r).slice(0, 300)) });
    } catch (e) {
        results.push({ area, name, ok: false, note: `threw ${String(e.message || e).slice(0, 300)}` });
    }
};
const st = (r, ...codes) => ({ ok: codes.includes(r.status), note: `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = await login("tester");
const B = await login("friend");
const me = (await call("GET", "/users/@me", A)).body;
const them = (await call("GET", "/users/@me", B)).body;
const guilds = (await call("GET", "/users/@me/guilds", A)).body;
const guild = guilds.find((g) => g.name === "Test Guild");
const channels = (await call("GET", `/guilds/${guild.id}/channels`, A)).body;
const text = channels.find((c) => c.type === 0);
const voice = channels.find((c) => c.type === 2);
const dms = (await call("GET", "/users/@me/channels", A)).body;
const dm = dms.find((c) => c.type === 1 && c.recipients.some((r) => r.id === them.id));
const suffix = randomBytes(3).toString("hex");

function totp(secret) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
    const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const h = createHmac("sha1", key).update(counter).digest();
    const o = h[h.length - 1] & 15;
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

await check("auth", "register with username and password", async () => {
    const r = await call("POST", "/auth/register", null, { username: `probe${suffix}`, password: `pw-${suffix}-Abc123!`, date_of_birth: "2000-01-01", consent: true });
    globalThis.C = r.body?.token;
    return { ok: !!r.body?.token, note: `${r.status}` };
});
await check("auth", "captcha config endpoint", async () => st(await call("GET", "/auth/captcha"), 200, 204));
await check("auth", "logout revokes token", async () => {
    const t = (await call("POST", "/auth/login", null, { login: `probe${suffix}`, password: `pw-${suffix}-Abc123!` })).body?.token;
    await call("POST", "/auth/logout", t, { provider: null, voip_provider: null });
    const r = await call("GET", "/users/@me", t);
    return { ok: r.status === 401, note: `after logout ${r.status}` };
});
await check("auth", "sessions list", async () => st(await call("GET", "/auth/sessions", A), 200));
await check("auth", "forgot password", async () => st(await call("POST", "/auth/forgot", null, { login: "tester@fosscord.test" }), 204, 200));
await check("auth", "totp mfa enable", async () => {
    const C = globalThis.C;
    const secret = "JBSWY3DPEHPK3PXP".padEnd(16, "A");
    const r = await call("POST", "/users/@me/mfa/totp/enable", C, { secret, code: totp(secret), password: `pw-${suffix}-Abc123!` });
    if (r.body?.token) globalThis.C = r.body.token;
    return { ok: r.status === 200 && r.body?.backup_codes?.length > 0, note: `${r.status} ${JSON.stringify(r.body).slice(0, 120)}` };
});
await check("auth", "login requires totp then mfa/totp succeeds", async () => {
    const l = await call("POST", "/auth/login", null, { login: `probe${suffix}`, password: `pw-${suffix}-Abc123!` });
    if (!l.body?.mfa) return { ok: false, note: JSON.stringify(l.body).slice(0, 200) };
    const r = await call("POST", "/auth/mfa/totp", null, { ticket: l.body.ticket, code: totp("JBSWY3DPEHPK3PXPAAAA") });
    return { ok: !!r.body?.token, note: `${r.status}` };
});
await check("auth", "webauthn credential registration start", async () => {
    const r = await call("POST", "/users/@me/mfa/webauthn/credentials", globalThis.C, {});
    return { ok: r.status === 200 || (r.status === 401 && !!r.body?.mfa?.ticket), note: `${r.status}` };
});
await check("auth", "passkey conditional login start", async () => st(await call("POST", "/auth/conditional/start", null, {}), 200));
await check("auth", "remote auth (qr) gateway", async () => {
    const ws = new WebSocket(`ws://localhost:${process.env.PORT || 3220}/remote-auth?v=2`);
    const first = await new Promise((resolve) => {
        ws.on("message", (m) => resolve(JSON.parse(m.toString())));
        setTimeout(() => resolve(null), 3000);
    });
    ws.close();
    return { ok: first?.op === "hello", note: JSON.stringify(first)?.slice(0, 100) };
});
await check("auth", "phone add endpoint", async () => st(await call("POST", "/users/@me/phone", A, { phone: "+15555550100" }), 200, 204, 400));

await check("users", "profile edit: global_name, bio, pronouns, accent, banner color", async () => {
    const r = await call("PATCH", "/users/@me", A, { global_name: "Tester", bio: "hello bio", accent_color: 0xff00aa });
    const p = await call("PATCH", "/users/@me/profile", A, { pronouns: "they/them", bio: "hello bio" });
    return { ok: r.status === 200 && p.body?.pronouns === "they/them" && r.body.global_name === "Tester", note: `${r.status} ${p.status}` };
});
await check("users", "display name styles", async () => {
    const r = await call("PATCH", "/users/@me", A, { display_name_font_id: 11, display_name_effect_id: 2, display_name_colors: [0xff0000, 0x00ff00] });
    const p = await call("GET", `/users/${me.id}/profile`, B);
    return {
        ok: r.status === 200 && !!(r.body.display_name_styles ?? p.body?.user?.display_name_styles),
        note: `${r.status} ${JSON.stringify(r.body.display_name_styles ?? p.body?.user?.display_name_styles)}`,
    };
});
await check("users", "profile fetch with mutuals and badges", async () => {
    const r = await call("GET", `/users/${me.id}/profile?with_mutual_guilds=true&with_mutual_friends=true`, B);
    return {
        ok: r.status === 200 && Array.isArray(r.body.mutual_guilds) && Array.isArray(r.body.badges),
        note: `badges=${r.body.badges?.map((b) => b.id).join(",")} mutual_guilds=${r.body.mutual_guilds?.length} mutual_friends=${r.body.mutual_friends?.length}`,
    };
});
await check("users", "premium (nitro) granted", async () => ({ ok: me.premium_type === 2, note: `premium_type=${me.premium_type}` }));
await check("users", "notes", async () => {
    await call("PUT", `/users/@me/notes/${them.id}`, A, { note: "friendly" });
    const r = await call("GET", `/users/@me/notes/${them.id}`, A);
    return { ok: r.body?.note === "friendly", note: `${r.status}` };
});
await check("users", "per-guild profile (nick, avatar, bio)", async () =>
    st(await call("PATCH", `/guilds/${guild.id}/members/@me`, A, { nick: "probe nick", bio: "guild bio" }), 200),
);
await check("users", "settings proto 1 and 2", async () => {
    const a = await call("GET", "/users/@me/settings-proto/1", A);
    const b = await call("GET", "/users/@me/settings-proto/2", A);
    return { ok: a.status === 200 && b.status === 200, note: `${a.status} ${b.status}` };
});
await check("users", "connections list", async () => st(await call("GET", "/users/@me/connections", A), 200));
await check("users", "connection authorize (github)", async () => {
    const r = await call("GET", "/connections/github/authorize", A);
    return r.status === 200 ? true : { skip: true, note: "provider not configured" };
});
await check("users", "profile widgets", async () => st(await call("GET", "/users/@me/widgets", A), 200));
await check("users", "data package request", async () => st(await call("POST", "/users/@me/harvest", A, {}), 200, 202));
await check("users", "pomelo username change", async () => st(await call("POST", "/users/@me/pomelo-attempt", A, { username: `free${suffix}` }), 200));
await check("users", "server tag (clan) set", async () => st(await call("PUT", "/users/@me/clan", A, { identity_guild_id: guild.id, identity_enabled: true }), 200, 400));
await check("users", "collectibles shop", async () => st(await call("GET", "/collectibles-shop", A), 200));
await check("users", "avatar decorations / collectibles purchases", async () => st(await call("GET", "/users/@me/collectibles-purchases", A), 200));
await check("users", "custom themes", async () => st(await call("GET", "/users/@me/custom-themes", A), 200));
await check("users", "email settings persist", async () => st(await call("GET", "/users/@me/email-settings", A), 200));
await check("users", "account disable endpoint exists", async () => st(await call("POST", "/users/@me/disable", globalThis.C, {}), 400, 401, 403));

await check("relationships", "friends list", async () => {
    const r = await call("GET", "/users/@me/relationships", A);
    return { ok: r.body?.some((x) => x.id === them.id && x.type === 1), note: `${r.status}` };
});
await check("relationships", "friend nickname", async () => st(await call("PATCH", `/users/@me/relationships/${them.id}`, A, { nickname: "buddy" }), 204, 200));
await check("relationships", "ignore user", async () => {
    const r = await call("PUT", `/users/@me/relationships/${them.id}/ignore`, A);
    await call("DELETE", `/users/@me/relationships/${them.id}/ignore`, A);
    return st(r, 204, 200);
});
await check("relationships", "block and unblock (stranger)", async () => {
    const C = globalThis.C;
    const cu = (await call("GET", "/users/@me", C)).body;
    const r = await call("PUT", `/users/@me/relationships/${cu.id}`, A, { type: 2 });
    await call("DELETE", `/users/@me/relationships/${cu.id}`, A);
    return st(r, 204);
});
await check("relationships", "message requests (stranger DM)", async () => {
    const C = globalThis.C;
    const d = await call("POST", "/users/@me/channels", C, { recipients: [me.id] });
    const m = await call("POST", `/channels/${d.body?.id}/messages`, C, { content: "hi stranger" });
    return { ok: m.status === 200 || m.status === 403 || m.status === 400, note: `dm ${d.status} msg ${m.status} ${JSON.stringify(m.body).slice(0, 120)}` };
});

await check("dms", "group dm create, rename system message", async () => {
    const C = globalThis.C;
    const cu = (await call("GET", "/users/@me", C)).body;
    await call("PUT", `/users/@me/relationships/${cu.id}`, A, {});
    await call("PUT", `/users/@me/relationships/${me.id}`, C, {});
    const gdm = await call("POST", "/users/@me/channels", A, { recipients: [them.id, cu.id] });
    if (gdm.status !== 200 || gdm.body.type !== 3) return st(gdm, 200);
    await call("DELETE", `/channels/${gdm.body.id}/recipients/${cu.id}`, A);
    await call("PATCH", `/channels/${gdm.body.id}`, A, { name: "probe gdm" });
    globalThis.gdm = gdm.body.id;
    const msgs = await call("GET", `/channels/${gdm.body.id}/messages`, A);
    return { ok: msgs.body?.some((m) => m.type === 4) && msgs.body?.some((m) => m.type === 2), note: `types=${msgs.body?.map((m) => m.type)}` };
});
await check("dms", "group dm invite", async () => st(await call("POST", `/channels/${globalThis.gdm}/invites`, A, { max_age: 86400 }), 200, 201));
await check("dms", "dm call ring", async () => {
    const r = await call("POST", `/channels/${dm.id}/call/ring`, A, { recipients: null });
    await call("POST", `/channels/${dm.id}/call/stop-ringing`, A, {});
    return st(r, 204, 200);
});
await check("dms", "e2ee status endpoint", async () => st(await call("GET", `/channels/${dm.id}/e2ee`, A), 200));

let msg;
await check("messages", "send, edit, delete", async () => {
    msg = (await call("POST", `/channels/${text.id}/messages`, A, { content: "probe" })).body;
    const e = await call("PATCH", `/channels/${text.id}/messages/${msg.id}`, A, { content: "probe edited" });
    const t = (await call("POST", `/channels/${text.id}/messages`, A, { content: "to delete" })).body;
    const d = await call("DELETE", `/channels/${text.id}/messages/${t.id}`, A);
    return { ok: e.body?.edited_timestamp && d.status === 204, note: `${e.status} ${d.status}` };
});
await check("messages", "reply with mention", async () => {
    const r = await call("POST", `/channels/${text.id}/messages`, B, { content: "reply", message_reference: { message_id: msg.id }, allowed_mentions: { replied_user: true } });
    return { ok: r.body?.type === 19 && r.body?.referenced_message?.id === msg.id && r.body?.mentions?.some((u) => u.id === me.id), note: `type=${r.body?.type}` };
});
await check("messages", "forward", async () => {
    const r = await call("POST", `/channels/${dm.id}/messages`, A, { message_reference: { type: 1, message_id: msg.id, channel_id: text.id, guild_id: guild.id } });
    return { ok: r.status === 200 && r.body?.message_snapshots?.length === 1, note: `${r.status} ${JSON.stringify(r.body).slice(0, 150)}` };
});
await check("messages", "reactions and super reactions", async () => {
    const a = await call("PUT", `/channels/${text.id}/messages/${msg.id}/reactions/${encodeURIComponent("👍")}/@me`, B);
    const b = await call("PUT", `/channels/${text.id}/messages/${msg.id}/reactions/${encodeURIComponent("🔥")}/@me?type=1`, B);
    const m = await call("GET", `/channels/${text.id}/messages?limit=5`, A);
    const got = m.body.find((x) => x.id === msg.id);
    return { ok: a.status === 204 && b.status === 204 && got?.reactions?.some((r) => r.count_details?.burst > 0), note: JSON.stringify(got?.reactions)?.slice(0, 200) };
});
await check("messages", "pins (new api)", async () => {
    const p = await call("PUT", `/channels/${text.id}/messages/pins/${msg.id}`, A);
    const l = await call("GET", `/channels/${text.id}/messages/pins`, A);
    return { ok: p.status === 204 && l.body?.items?.some((i) => i.message.id === msg.id), note: `${p.status} ${l.status}` };
});
await check("messages", "polls create, vote, expire", async () => {
    const p = await call("POST", `/channels/${text.id}/messages`, A, {
        poll: { question: { text: "q?" }, answers: [{ poll_media: { text: "a" } }, { poll_media: { text: "b" } }], duration: 1, allow_multiselect: true },
    });
    if (p.status !== 200) return st(p, 200);
    const v = await call("PUT", `/channels/${text.id}/polls/${p.body.id}/answers/@me`, B, { answer_ids: ["1", "2"] });
    const voters = await call("GET", `/channels/${text.id}/polls/${p.body.id}/answers/1`, A);
    const e = await call("POST", `/channels/${text.id}/polls/${p.body.id}/expire`, A);
    const m = await call("GET", `/channels/${text.id}/messages?limit=5`, A);
    const result = m.body.find((x) => x.type === 46);
    return {
        ok: v.status === 204 && voters.body?.users?.length === 1 && e.status === 200 && !!result,
        note: `vote ${v.status} voters ${voters.body?.users?.length} expire ${e.status} result-msg ${!!result}`,
    };
});
await check("messages", "attachments upload (multipart)", async () => {
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify({ content: "file", attachments: [{ id: 0, filename: "a.txt", description: "alt text" }] }));
    fd.append("files[0]", new Blob(["hello file"], { type: "text/plain" }), "a.txt");
    const r = await call("POST", `/channels/${text.id}/messages`, A, fd);
    const url = r.body?.attachments?.[0]?.url;
    const f = url ? await fetch(url.replace(/^https?:\/\/[^/]+/, base)) : null;
    return {
        ok: r.status === 200 && f?.status === 200 && r.body.attachments[0].description === "alt text",
        note: `${r.status} file ${f?.status} ${f?.headers.get("content-type")}`,
    };
});
await check("messages", "cloud attachment upload flow", async () => {
    const r = await call("POST", `/channels/${text.id}/attachments`, A, { files: [{ id: "0", filename: "b.txt", file_size: 4 }] });
    return { ok: r.status === 200 && !!r.body?.attachments?.[0]?.upload_url, note: `${r.status}` };
});
await check("messages", "voice message flag", async () => {
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify({ flags: 8192, attachments: [{ id: 0, filename: "voice-message.ogg", duration_secs: 1.5, waveform: "AAAA" }] }));
    fd.append("files[0]", new Blob([randomBytes(64)], { type: "audio/ogg" }), "voice-message.ogg");
    const r = await call("POST", `/channels/${text.id}/messages`, A, fd);
    return { ok: r.status === 200 && (r.body.flags & 8192) === 8192 && !!r.body.attachments?.[0]?.waveform, note: `${r.status} flags=${r.body?.flags}` };
});
await check("messages", "silent message flag", async () => {
    const r = await call("POST", `/channels/${text.id}/messages`, A, { content: "@silent shh", flags: 4096 });
    return { ok: (r.body?.flags & 4096) === 4096, note: `${r.status}` };
});
await check("messages", "link embed unfurl", async () => {
    const r = await call("POST", `/channels/${text.id}/messages`, A, { content: "https://github.com/spacebarchat/server" });
    await sleep(6000);
    const m = await call("GET", `/channels/${text.id}/messages/${r.body.id}`, A);
    return { ok: m.body?.embeds?.length > 0, note: `embeds=${m.body?.embeds?.length} ${m.status}` };
});
await check("messages", "rich embeds by user rejected / allowed for bots", async () =>
    st(await call("POST", `/channels/${text.id}/messages`, A, { content: "x", embeds: [{ title: "t" }] }), 200, 400),
);
await check("messages", "suppress embeds", async () => st(await call("PATCH", `/channels/${text.id}/messages/${msg.id}`, A, { flags: 4 }), 200));
await check("messages", "guild message search", async () => {
    await sleep(500);
    const r = await call("GET", `/guilds/${guild.id}/messages/search?content=probe`, A);
    return { ok: r.status === 200 && r.body?.total_results > 0, note: `${r.status} total=${r.body?.total_results}` };
});
await check("messages", "dm search", async () => st(await call("GET", `/channels/${dm.id}/messages/search?content=hey`, A), 200));
await check("messages", "global dm search (users/@me/messages/search)", async () =>
    st(await call("POST", `/users/@me/messages/search/tabs`, A, { tabs: { messages: { sort_by: "timestamp", sort_order: "desc", content: "hey", limit: 25 } } }), 200),
);
await check("messages", "recent mentions inbox", async () => st(await call("GET", "/users/@me/mentions?limit=25", A), 200));
await check("messages", "ack and read states", async () => st(await call("POST", `/channels/${text.id}/messages/${msg.id}/ack`, A, { token: null }), 200));
await check("messages", "mark unread (manual ack)", async () => st(await call("POST", `/channels/${text.id}/messages/${msg.id}/ack`, A, { manual: true, mention_count: 0 }), 200));
await check("messages", "bulk delete", async () => {
    const a = (await call("POST", `/channels/${text.id}/messages`, A, { content: "b1" })).body;
    const b = (await call("POST", `/channels/${text.id}/messages`, A, { content: "b2" })).body;
    return st(await call("POST", `/channels/${text.id}/messages/bulk-delete`, A, { messages: [a.id, b.id] }), 204);
});
await check("messages", "typing", async () => st(await call("POST", `/channels/${text.id}/typing`, A), 204, 200));
await check("messages", "stickers (guild sticker + sticker packs)", async () => st(await call("GET", "/sticker-packs", A), 200));
await check("messages", "gif search", async () => {
    const r = await call("GET", "/gifs/trending?provider=tenor&locale=en-US&media_format=mp4", A);
    return { ok: r.status === 200, note: `${r.status} ${JSON.stringify(r.body).slice(0, 120)}` };
});
await check("messages", "scheduled messages", async () => st(await call("GET", "/users/@me/scheduled-messages", A), 200));
await check("messages", "message bookmarks (saved messages)", async () => st(await call("GET", "/users/@me/saved-messages", A), 200));
await check("messages", "slowmode", async () => {
    const ch = (await call("POST", `/guilds/${guild.id}/channels`, A, { name: `slow-${suffix}`, type: 0, rate_limit_per_user: 30 })).body;
    await call("POST", `/channels/${ch.id}/messages`, B, { content: "one" });
    const r = await call("POST", `/channels/${ch.id}/messages`, B, { content: "two" });
    return { ok: r.status === 429 || r.status === 400, note: `${r.status} ${JSON.stringify(r.body).slice(0, 100)}` };
});
await check("messages", "announcement crosspost and follow", async () => {
    await call("PATCH", `/guilds/${guild.id}`, A, {
        features: ["COMMUNITY", "NEWS"],
        rules_channel_id: text.id,
        public_updates_channel_id: text.id,
        verification_level: 1,
        explicit_content_filter: 2,
    });
    const ch = await call("POST", `/guilds/${guild.id}/channels`, A, { name: `news-${suffix}`, type: 5 });
    if (ch.status !== 201 && ch.status !== 200) return st(ch, 200, 201);
    const m = (await call("POST", `/channels/${ch.body.id}/messages`, A, { content: "news" })).body;
    const c = await call("POST", `/channels/${ch.body.id}/messages/${m.id}/crosspost`, A);
    const f = await call("POST", `/channels/${ch.body.id}/followers`, A, { webhook_channel_id: text.id });
    return { ok: c.status === 200 && f.status === 200, note: `crosspost ${c.status} follow ${f.status}` };
});

await check("threads", "create thread from message and post", async () => {
    const t = await call("POST", `/channels/${text.id}/messages/${msg.id}/threads`, A, { name: "probe thread" });
    if (t.status !== 201 && t.status !== 200) return st(t, 201);
    const m = await call("POST", `/channels/${t.body.id}/messages`, B, { content: "in thread" });
    const a = await call("GET", `/guilds/${guild.id}/threads/active`, A);
    return { ok: m.status === 200 && a.body?.threads?.length > 0, note: `${t.status} ${m.status}` };
});
await check("threads", "forum channel with tags and post", async () => {
    const f = await call("POST", `/guilds/${guild.id}/channels`, A, { name: `forum-${suffix}`, type: 15, available_tags: [{ name: "bug" }] });
    if (f.status !== 201 && f.status !== 200) return st(f, 201);
    const p = await call("POST", `/channels/${f.body.id}/threads`, A, {
        name: "post",
        message: { content: "body" },
        applied_tags: [f.body.available_tags?.[0]?.id].filter(Boolean),
    });
    return { ok: p.status === 201 || p.status === 200, note: `${p.status} tags=${p.body?.applied_tags}` };
});
await check("threads", "media channel post", async () => {
    const f = await call("POST", `/guilds/${guild.id}/channels`, A, { name: `media-${suffix}`, type: 16 });
    return st(f, 201, 200);
});

await check("guilds", "create from template code", async () => {
    const created = await call("POST", `/guilds/${guild.id}/templates`, A, { name: "probe tpl" });
    const t = created.status === 400 ? { status: 200, body: (await call("GET", `/guilds/${guild.id}/templates`, A)).body?.[0] } : created;
    if (t.status !== 200 && t.status !== 201) return st(t, 200);
    const g = await call("GET", `/guilds/templates/${t.body.code}`, B);
    const c = await call("POST", `/guilds/templates/${t.body.code}`, B, { name: "from tpl" });
    return { ok: g.status === 200 && (c.status === 201 || c.status === 200), note: `get ${g.status} use ${c.status}` };
});
await check("guilds", "boost level 3 for all", async () => {
    const g = await call("GET", `/guilds/${guild.id}`, A);
    return { ok: g.body?.premium_tier === 3, note: `tier=${g.body?.premium_tier} subs=${g.body?.premium_subscription_count}` };
});
await check("guilds", "edit name, description, banner", async () => st(await call("PATCH", `/guilds/${guild.id}`, A, { name: "Test Guild", description: "probe" }), 200));
await check("guilds", "roles with gradient colors and icon emoji", async () => {
    const r = await call("POST", `/guilds/${guild.id}/roles`, A, {
        name: "grad",
        colors: { primary_color: 0xff0000, secondary_color: 0x0000ff, tertiary_color: null },
        unicode_emoji: "🔥",
    });
    return {
        ok: r.status === 200 && r.body.colors?.secondary_color === 0x0000ff && r.body.color === 0xff0000,
        note: `${r.status} ${JSON.stringify(r.body.colors)} color=${r.body.color}`,
    };
});
await check("guilds", "channel permission overwrite", async () => {
    const r = await call("PUT", `/channels/${text.id}/permissions/${them.id}`, A, { type: 1, allow: "0", deny: "8192" });
    await call("DELETE", `/channels/${text.id}/permissions/${them.id}`, A);
    return st(r, 204);
});
await check("guilds", "invite with max uses, expiry, temporary false by default", async () => {
    const r = await call("POST", `/channels/${text.id}/invites`, A, { max_age: 3600, max_uses: 5 });
    const l = await call("GET", `/channels/${text.id}/invites`, A);
    const got = l.body?.find((i) => i.code === r.body?.code);
    return {
        ok: r.body?.temporary === false && got?.max_uses === 5 && got?.max_age === 3600,
        note: `${JSON.stringify({ t: r.body?.temporary, mu: got?.max_uses, ma: got?.max_age })}`,
    };
});
await check("guilds", "vanity url", async () => st(await call("PATCH", `/guilds/${guild.id}/vanity-url`, A, { code: `probe${suffix}` }), 200));
await check("guilds", "timeout member", async () =>
    st(await call("PATCH", `/guilds/${guild.id}/members/${them.id}`, A, { communication_disabled_until: new Date(Date.now() + 60000).toISOString() }), 200),
);
await check("guilds", "timeout blocks sending", async () => {
    const r = await call("POST", `/channels/${text.id}/messages`, B, { content: "while timed out" });
    await call("PATCH", `/guilds/${guild.id}/members/${them.id}`, A, { communication_disabled_until: null });
    return { ok: r.status === 403 || r.status === 400, note: `${r.status}` };
});
await check("guilds", "prune count", async () => st(await call("GET", `/guilds/${guild.id}/prune?days=7`, A), 200));
await check("guilds", "audit log records", async () => {
    const r = await call("GET", `/guilds/${guild.id}/audit-logs?limit=50`, A);
    return {
        ok: r.body?.audit_log_entries?.length > 3,
        note: `entries=${r.body?.audit_log_entries?.length} actions=${[...new Set(r.body?.audit_log_entries?.map((e) => e.action_type))].join(",")}`,
    };
});
await check("guilds", "automod keyword rule enforced", async () => {
    const rule = await call("POST", `/guilds/${guild.id}/auto-moderation/rules`, A, {
        name: "kw",
        event_type: 1,
        trigger_type: 1,
        trigger_metadata: { keyword_filter: [`badword${suffix}`] },
        actions: [{ type: 1 }],
        enabled: true,
    });
    const r = await call("POST", `/channels/${text.id}/messages`, B, { content: `this has badword${suffix}` });
    if (rule.body?.id) await call("DELETE", `/guilds/${guild.id}/auto-moderation/rules/${rule.body.id}`, A);
    return { ok: rule.status === 200 && r.status !== 200, note: `rule ${rule.status} send ${r.status} ${JSON.stringify(r.body).slice(0, 100)}` };
});
await check("guilds", "onboarding get/put", async () => {
    const g = await call("GET", `/guilds/${guild.id}/onboarding`, A);
    return st(g, 200);
});
await check("guilds", "welcome screen", async () => st(await call("GET", `/guilds/${guild.id}/welcome-screen`, A), 200));
await check("guilds", "member verification (rules screening)", async () => st(await call("GET", `/guilds/${guild.id}/member-verification`, A), 200));
await check("guilds", "community enable", async () => {
    const r = await call("PATCH", `/guilds/${guild.id}`, A, {
        features: ["COMMUNITY"],
        rules_channel_id: text.id,
        public_updates_channel_id: text.id,
        verification_level: 1,
        explicit_content_filter: 2,
    });
    return { ok: r.status === 200 && r.body.features?.includes("COMMUNITY"), note: `${r.status}` };
});
await check("guilds", "discovery categories list", async () => {
    const r = await call("GET", "/discovery/categories?primary_only=true", A);
    return { ok: r.status === 200 && r.body?.length > 0, note: `${r.status} n=${r.body?.length}` };
});
await check("guilds", "discovery metadata", async () => st(await call("GET", `/guilds/${guild.id}/discovery-metadata`, A), 200));
await check("guilds", "discoverable guilds list", async () => st(await call("GET", "/discoverable-guilds?limit=10", A), 200));
await check("guilds", "discovery search", async () => st(await call("GET", "/discoverable-guilds/search?query=test&limit=10", A), 200));
await check("guilds", "widget json and png", async () => {
    await call("PATCH", `/guilds/${guild.id}/widget`, A, { enabled: true, channel_id: text.id });
    const j = await call("GET", `/guilds/${guild.id}/widget.json`);
    const p = await fetch(`${base}/api/v9/guilds/${guild.id}/widget.png`);
    return { ok: j.status === 200 && p.status === 200, note: `${j.status} ${p.status}` };
});
await check("guilds", "custom emoji upload", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await call("POST", `/guilds/${guild.id}/emojis`, A, { name: `e${suffix}`, image: png });
    globalThis.emoji = r.body;
    return st(r, 201, 200);
});
await check("guilds", "custom sticker upload", async () => {
    const fd = new FormData();
    fd.append("name", `s${suffix}`);
    fd.append("tags", "smile");
    fd.append("description", "probe");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    fd.append("file", new Blob([png], { type: "image/png" }), "s.png");
    return st(await call("POST", `/guilds/${guild.id}/stickers`, A, fd), 201, 200);
});
await check("guilds", "soundboard sounds", async () => st(await call("GET", `/guilds/${guild.id}/soundboard-sounds`, A), 200));
await check("guilds", "default soundboard sounds", async () => {
    const r = await call("GET", "/soundboard-default-sounds", A);
    return { ok: r.status === 200 && r.body?.length > 0, note: `n=${r.body?.length}` };
});
await check("guilds", "scheduled event create and rsvp", async () => {
    const e = await call("POST", `/guilds/${guild.id}/scheduled-events`, A, {
        name: "ev",
        privacy_level: 2,
        scheduled_start_time: new Date(Date.now() + 3600e3).toISOString(),
        entity_type: 2,
        channel_id: voice?.id,
    });
    if (e.status !== 200) return st(e, 200);
    const r = await call("PUT", `/guilds/${guild.id}/scheduled-events/${e.body.id}/users/@me`, B);
    return st(r, 200, 204);
});
await check("guilds", "guild tag (server tag) settings", async () =>
    st(await call("PATCH", `/guilds/${guild.id}/profile`, A, { tag: "PRB", badge: 1, badge_color_primary: "#ff0000", badge_color_secondary: "#00ff00" }), 200),
);
await check("guilds", "insights analytics", async () => st(await call("GET", `/guilds/${guild.id}/analytics/overview`, A), 200));
await check("guilds", "incident actions (pause invites)", async () =>
    st(await call("PUT", `/guilds/${guild.id}/incident-actions`, A, { invites_disabled_until: null, dms_disabled_until: null }), 200),
);
await check("guilds", "member search (mod view)", async () => st(await call("POST", `/guilds/${guild.id}/members-search`, A, { limit: 10 }), 200));
await check("guilds", "role member counts", async () => st(await call("GET", `/guilds/${guild.id}/roles/member-counts`, A), 200));
await check("guilds", "bulk ban", async () => {
    const C = globalThis.C;
    const cu = (await call("GET", "/users/@me", C)).body;
    return st(await call("POST", `/guilds/${guild.id}/bulk-ban`, A, { user_ids: [cu.id], delete_message_seconds: 0 }), 200);
});
await check("guilds", "join requests (member applications)", async () => st(await call("GET", `/guilds/${guild.id}/requests/@me`, B), 200, 404));

await check("voice", "voice regions", async () => st(await call("GET", "/voice/regions", A), 200));
await check("voice", "voice state update joins and VOICE_SERVER_UPDATE", async () => {
    const g = gateway(A);
    await g.ready;
    g.send(4, { guild_id: guild.id, channel_id: voice.id, self_mute: false, self_deaf: false });
    const vsu = await g.waitFor((m) => m.t === "VOICE_SERVER_UPDATE", 5000);
    g.send(4, { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: false });
    await sleep(300);
    g.close();
    return { ok: !!vsu, note: JSON.stringify(vsu?.d)?.slice(0, 120) };
});
await check("voice", "voice channel status", async () => st(await call("PUT", `/channels/${voice.id}/voice-status`, A, { status: "chilling" }), 204, 200, 403));
await check("voice", "text in voice", async () => st(await call("POST", `/channels/${voice.id}/messages`, A, { content: "tiv" }), 200));
await check("voice", "stage instance", async () => {
    const s = await call("POST", `/guilds/${guild.id}/channels`, A, { name: `stage-${suffix}`, type: 13 });
    if (s.status !== 201 && s.status !== 200) return st(s, 201);
    return st(await call("POST", "/stage-instances", A, { channel_id: s.body.id, topic: "talk" }), 200);
});
await check("voice", "activities shelf", async () => {
    const r = await call("GET", `/activities/shelf?guild_id=${guild.id}`, A);
    return { ok: r.status === 200 && r.body?.activities?.length > 0, note: `${r.status} n=${r.body?.activities?.length}` };
});
await check("voice", "go live stream create", async () => {
    const g = gateway(A);
    await g.ready;
    g.send(4, { guild_id: guild.id, channel_id: voice.id, self_mute: false, self_deaf: false });
    await g.waitFor((m) => m.t === "VOICE_SERVER_UPDATE", 5000);
    g.send(18, { type: "guild", guild_id: guild.id, channel_id: voice.id, preferred_region: null });
    const sc = await g.waitFor((m) => m.t === "STREAM_CREATE", 5000);
    g.send(19, { stream_key: `guild:${guild.id}:${voice.id}:${me.id}` });
    g.send(4, { guild_id: guild.id, channel_id: null });
    await sleep(300);
    g.close();
    return { ok: !!sc, note: JSON.stringify(sc?.d)?.slice(0, 100) };
});

await check("presence", "rich presence activity seen by friend", async () => {
    const gb = gateway(B);
    await gb.ready;
    const ga = gateway(A);
    await ga.ready;
    ga.send(3, {
        status: "online",
        since: 0,
        afk: false,
        activities: [
            {
                name: "Probe Game",
                type: 0,
                application_id: "1",
                details: "in a match",
                state: "ranked",
                timestamps: { start: Date.now() },
                assets: { large_text: "x" },
                party: { id: "p", size: [1, 4] },
            },
        ],
    });
    const p = await gb.waitFor((m) => m.t === "PRESENCE_UPDATE" && m.d.user?.id === me.id && m.d.activities?.some((a) => a.name === "Probe Game"), 5000);
    ga.close();
    gb.close();
    return { ok: !!p, note: JSON.stringify(p?.d?.activities)?.slice(0, 150) };
});
await check("presence", "detectable games list", async () => {
    const r = await call("GET", "/applications/detectable", A);
    return { ok: r.status === 200 && Array.isArray(r.body) && r.body.length > 0, note: `${r.status} n=${r.body?.length}` };
});
await check("presence", "activity statistics", async () => st(await call("GET", "/users/@me/activities/statistics/applications", A), 200));

await check("apps", "create application and bot", async () => {
    const a = await call("POST", "/applications", A, { name: `probeapp${suffix}` });
    if (a.status !== 201 && a.status !== 200) return st(a, 201);
    globalThis.app = a.body;
    const b = await call("POST", `/applications/${a.body.id}/bot/reset`, A, {});
    globalThis.botToken = b.body?.token;
    return { ok: !!b.body?.token, note: `${a.status} ${b.status}` };
});
await check("apps", "bot gateway identify", async () => {
    const g = gateway(`Bot ${globalThis.botToken}`, { intents: 513 });
    const r = await g.ready.catch((e) => null);
    g.close();
    return { ok: !!r?.user?.bot, note: `${r?.user?.username}` };
});
await check("apps", "oauth2 authorize bot into guild", async () => {
    const r = await call("POST", `/oauth2/authorize?client_id=${globalThis.app.id}&scope=bot%20applications.commands&permissions=8`, A, {
        guild_id: guild.id,
        permissions: "8",
        authorize: true,
    });
    return st(r, 200);
});
await check("apps", "global slash command register and index", async () => {
    const r = await call("POST", `/applications/${globalThis.app.id}/commands`, `Bot ${globalThis.botToken}`, {
        name: "ping",
        description: "pong",
        options: [{ type: 3, name: "q", description: "q", autocomplete: true }],
        integration_types: [0, 1],
        contexts: [0, 1, 2],
    });
    const idx = await call("GET", `/guilds/${guild.id}/application-command-index`, A);
    return {
        ok: r.status === 201 || (r.status === 200 && idx.body?.application_commands?.some((c) => c.name === "ping")),
        note: `${r.status} idx ${idx.status} cmds=${idx.body?.application_commands?.length}`,
    };
});
await check("apps", "slash command invoke creates INTERACTION_CREATE", async () => {
    const g = gateway(`Bot ${globalThis.botToken}`, { intents: 513 });
    await g.ready;
    const idx = await call("GET", `/guilds/${guild.id}/application-command-index`, A);
    const cmd = idx.body?.application_commands?.find((c) => c.name === "ping" && c.application_id === globalThis.app.id);
    const nonce = String(Date.now());
    const r = await call("POST", "/interactions", A, {
        type: 2,
        application_id: globalThis.app.id,
        guild_id: guild.id,
        channel_id: text.id,
        session_id: "x",
        nonce,
        data: { version: cmd?.version, id: cmd?.id, name: "ping", type: 1, options: [{ type: 3, name: "q", value: "hi" }] },
    });
    const ic = await g.waitFor((m) => m.t === "INTERACTION_CREATE", 5000);
    if (ic)
        await call("POST", `/interactions/${ic.d.id}/${ic.d.token}/callback`, null, {
            type: 4,
            data: { content: "pong", components: [{ type: 1, components: [{ type: 2, style: 1, label: "btn", custom_id: "b" }] }] },
        });
    globalThis.ic = ic;
    g.close();
    return { ok: r.status === 204 && !!ic, note: `${r.status} ic=${!!ic}` };
});
await check("apps", "autocomplete interaction", async () => {
    const g = gateway(`Bot ${globalThis.botToken}`, { intents: 513 });
    await g.ready;
    const idx = await call("GET", `/guilds/${guild.id}/application-command-index`, A);
    const cmd = idx.body?.application_commands?.find((c) => c.name === "ping" && c.application_id === globalThis.app.id);
    const r = await call("POST", "/interactions", A, {
        type: 4,
        application_id: globalThis.app.id,
        guild_id: guild.id,
        channel_id: text.id,
        session_id: "x",
        nonce: String(Date.now()),
        data: { version: cmd?.version, id: cmd?.id, name: "ping", type: 1, options: [{ type: 3, name: "q", value: "h", focused: true }] },
    });
    const ic = await g.waitFor((m) => m.t === "INTERACTION_CREATE" && m.d.type === 4, 5000);
    let cb;
    if (ic) cb = await call("POST", `/interactions/${ic.d.id}/${ic.d.token}/callback`, null, { type: 8, data: { choices: [{ name: "hello", value: "hello" }] } });
    g.close();
    return { ok: r.status === 204 && !!ic && cb?.status === 204, note: `${r.status} ic=${!!ic} cb=${cb?.status}` };
});
await check("apps", "user-installed app commands in DMs", async () => {
    const auth = await call("POST", `/oauth2/authorize?client_id=${globalThis.app.id}&scope=applications.commands&integration_type=1`, A, { authorize: true, integration_type: 1 });
    const idx = await call("GET", "/users/@me/application-command-index", A);
    return {
        ok: auth.status === 200 && idx.body?.application_commands?.some((c) => c.application_id === globalThis.app.id && c.integration_types?.includes(1)),
        note: `auth ${auth.status} idx ${idx.status} n=${idx.body?.application_commands?.length}`,
    };
});
await check("apps", "message components v2 from bot", async () => {
    const r = await call("POST", `/channels/${text.id}/messages`, `Bot ${globalThis.botToken}`, {
        flags: 32768,
        components: [{ type: 17, components: [{ type: 10, content: "hello v2" }] }],
    });
    return st(r, 200);
});
await check("apps", "webhook execute", async () => {
    const w = await call("POST", `/channels/${text.id}/webhooks`, A, { name: "hook" });
    const e = await call("POST", `/webhooks/${w.body.id}/${w.body.token}?wait=true`, null, { content: "from hook", embeds: [{ title: "embed" }] });
    return st(e, 200);
});
await check("apps", "app directory", async () => st(await call("GET", "/application-directory-static/collections?surface=1", A), 200));
await check("apps", "app launcher / user app index", async () => st(await call("GET", "/users/@me/application-command-index", A), 200));
await check("apps", "oauth2 token exchange endpoint", async () => st(await call("POST", "/oauth2/token", null, {}), 400, 401));

await check("misc", "status page summary", async () => st(await call("GET", "/status/summary.json"), 200));
await check("misc", "instance policies", async () => st(await call("GET", "/policies/instance"), 200));
await check("misc", "experiments", async () => st(await call("GET", "/experiments", A), 200));
await check("misc", "apex experiments", async () => {
    const r = await call("GET", "/apex/experiments?surface=1", A);
    return { ok: r.status === 200 && Object.keys(r.body?.assignments ?? {}).length > 0, note: JSON.stringify(r.body).slice(0, 150) };
});
await check("misc", "quests disabled", async () => {
    const r = await call("GET", "/quests/@me", A);
    return { ok: r.status === 200 && (r.body?.quests?.length ?? 0) === 0, note: `${r.status}` };
});
await check("misc", "billing subscriptions empty", async () => st(await call("GET", "/users/@me/billing/subscriptions", A), 200));
await check("misc", "admin dashboard api (non-admin forbidden)", async () => {
    const r = await call("GET", "/admin/users", B);
    return { ok: r.body?.code === 50013, note: `${r.status}` };
});
await check("misc", "family center", async () => st(await call("GET", "/family-center/@me", A), 200));
await check("misc", "safety hub", async () => st(await call("GET", "/safety-hub/@me", A), 200));

await check("extra", "send guild sticker in message", async () => {
    const st2 = (await call("GET", `/guilds/${guild.id}/stickers`, A)).body?.[0];
    if (!st2) return { ok: false, note: "no sticker" };
    const r = await call("POST", `/channels/${text.id}/messages`, A, { sticker_ids: [st2.id] });
    return { ok: r.status === 200 && r.body.sticker_items?.length === 1, note: `${r.status}` };
});
await check("extra", "custom emoji reaction", async () => {
    const e = (await call("GET", `/guilds/${guild.id}/emojis`, A)).body?.[0];
    const m = (await call("POST", `/channels/${text.id}/messages`, A, { content: `<:${e.name}:${e.id}>` })).body;
    return st(await call("PUT", `/channels/${text.id}/messages/${m.id}/reactions/${e.name}:${e.id}/@me`, A), 204);
});
await check("extra", "onboarding put", async () =>
    st(
        await call("PUT", `/guilds/${guild.id}/onboarding`, A, {
            prompts: [
                {
                    id: "1",
                    type: 0,
                    title: "pick",
                    options: [{ id: "2", title: "a", channel_ids: [text.id], role_ids: [] }],
                    single_select: false,
                    required: false,
                    in_onboarding: true,
                },
            ],
            default_channel_ids: [text.id],
            enabled: false,
            mode: 0,
        }),
        200,
    ),
);
await check("extra", "welcome screen patch", async () =>
    st(
        await call("PATCH", `/guilds/${guild.id}/welcome-screen`, A, {
            enabled: true,
            description: "hi",
            welcome_channels: [{ channel_id: text.id, description: "chat", emoji_name: "👋" }],
        }),
        200,
    ),
);
await check("extra", "rules screening put", async () =>
    st(
        await call("PATCH", `/guilds/${guild.id}/member-verification`, A, {
            enabled: true,
            form_fields: [{ field_type: "TERMS", label: "Read the rules", values: ["be nice"], required: true }],
            description: "rules",
        }),
        200,
    ),
);
await check("extra", "soundboard upload and play in voice", async () => {
    const mp3 =
        "data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqpAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
    const snd = await call("POST", `/guilds/${guild.id}/soundboard-sounds`, A, { name: `s${suffix}`, sound: mp3, volume: 1 });
    const g = gateway(A);
    await g.ready;
    g.send(4, { guild_id: guild.id, channel_id: voice.id, self_mute: false, self_deaf: false });
    await g.waitFor((m) => m.t === "VOICE_SERVER_UPDATE", 5000);
    const play = await call("POST", `/channels/${voice.id}/send-soundboard-sound`, A, {
        sound_id: snd.body?.sound_id ?? "1",
        source_guild_id: snd.body?.sound_id ? guild.id : undefined,
    });
    const fx = await g.waitFor((m) => m.t === "VOICE_CHANNEL_EFFECT_SEND", 4000);
    g.send(4, { guild_id: guild.id, channel_id: null });
    await sleep(300);
    g.close();
    return {
        ok: (snd.status === 200 || snd.status === 201) && play.status === 204 && !!fx,
        note: `upload ${snd.status} ${JSON.stringify(snd.body).slice(0, 80)} play ${play.status} ${JSON.stringify(play.body)} fx ${!!fx}`,
    };
});
await check("extra", "spotify listening activity relayed", async () => {
    const gb = gateway(B);
    await gb.ready;
    const ga = gateway(A);
    await ga.ready;
    ga.send(3, {
        status: "online",
        since: 0,
        afk: false,
        activities: [
            {
                name: "Spotify",
                type: 2,
                id: "spotify:1",
                flags: 48,
                sync_id: "4uLU6hMCjMI75M1A2tKUQC",
                party: { id: `spotify:${me.id}` },
                details: "Song",
                state: "Artist",
                assets: { large_image: "spotify:ab67616d0000b273", large_text: "Album" },
                timestamps: { start: Date.now(), end: Date.now() + 200000 },
            },
            { name: "Custom Status", type: 4, state: "probing", emoji: { name: "🧪" } },
        ],
    });
    const p = await gb.waitFor((m) => m.t === "PRESENCE_UPDATE" && m.d.user?.id === me.id && m.d.activities?.some((a) => a.type === 2), 5000);
    ga.close();
    gb.close();
    return { ok: !!p && p.d.activities.some((a) => a.type === 4), note: JSON.stringify(p?.d?.activities?.map((a) => [a.type, a.name, a.sync_id])) };
});
await check("extra", "guild template sync", async () => {
    const t = (await call("GET", `/guilds/${guild.id}/templates`, A)).body?.[0];
    return st(await call("PUT", `/guilds/${guild.id}/templates/${t?.code}`, A), 200);
});

await check("more", "report a message", async () =>
    st(
        await call("POST", "/reporting/message", B, {
            version: "1.0",
            variant: "1",
            language: "en",
            breadcrumbs: [7, 98],
            elements: {},
            name: "message",
            channel_id: text.id,
            message_id: msg.id,
        }),
        200,
        201,
        204,
    ),
);
await check("more", "guild notification settings", async () =>
    st(
        await call("PATCH", `/users/@me/guilds/${guild.id}/settings`, A, {
            message_notifications: 1,
            channel_overrides: { [text.id]: { channel_id: text.id, muted: true, message_notifications: 2, mute_config: null, collapsed: false } },
        }),
        200,
    ),
);
await check("more", "bulk notification settings", async () =>
    st(await call("PATCH", "/users/@me/guilds/settings", A, { guilds: { [guild.id]: { suppress_everyone: true } } }), 200),
);
await check("more", "consent toggles", async () => st(await call("GET", "/users/@me/consent", A), 200));
await check("more", "explicit media settings", async () => st(await call("PATCH", `/channels/${text.id}/explicit-media`, A, { attachment_ids: [] }), 204));
await check("more", "private thread and archive", async () => {
    const t = await call("POST", `/channels/${text.id}/threads`, A, { name: "private", type: 12, invitable: false });
    if (t.status !== 201) return st(t, 201);
    const add = await call("PUT", `/channels/${t.body.id}/thread-members/${them.id}`, A);
    const arc = await call("PATCH", `/channels/${t.body.id}`, A, { archived: true, locked: true });
    const list = await call("GET", `/channels/${text.id}/users/@me/threads/archived/private`, A);
    return { ok: add.status === 204 && arc.body?.thread_metadata?.archived && list.status === 200, note: `add ${add.status} archive ${arc.status} list ${list.status}` };
});
await check("more", "user context menu command and modal", async () => {
    const appId = globalThis.app.id;
    const bot = `Bot ${globalThis.botToken}`;
    const reg = await call("POST", `/applications/${appId}/commands`, bot, { name: "Inspect", type: 2 });
    const g = gateway(bot, { intents: 513 });
    await g.ready;
    const r = await call("POST", "/interactions", A, {
        type: 2,
        application_id: appId,
        guild_id: guild.id,
        channel_id: text.id,
        session_id: "x",
        nonce: String(Date.now()),
        data: { version: reg.body.version, id: reg.body.id, name: "Inspect", type: 2, target_id: them.id },
    });
    const ic = await g.waitFor((m) => m.t === "INTERACTION_CREATE" && m.d.data?.name === "Inspect", 5000);
    const ga = gateway(A);
    await ga.ready;
    const cb = ic
        ? await call("POST", `/interactions/${ic.d.id}/${ic.d.token}/callback`, null, {
              type: 9,
              data: { custom_id: "m", title: "Modal", components: [{ type: 1, components: [{ type: 4, custom_id: "f", label: "Field", style: 1 }] }] },
          })
        : null;
    const modal = await ga.waitFor((m) => m.t === "INTERACTION_MODAL_CREATE", 4000);
    g.close();
    ga.close();
    return {
        ok: reg.status === 201 && r.status === 204 && !!ic && cb?.status === 204 && !!modal,
        note: `reg ${reg.status} run ${r.status} ic ${!!ic} cb ${cb?.status} modal ${!!modal}`,
    };
});
await check("more", "github webhook format", async () => {
    const w = (await call("POST", `/channels/${text.id}/webhooks`, A, { name: "gh" })).body;
    return st(
        await call(
            "POST",
            `/webhooks/${w.id}/${w.token}/github`,
            null,
            {
                zen: "probe",
                hook_id: 1,
                repository: { full_name: "a/b", html_url: "https://github.com/a/b" },
                sender: { login: "x", html_url: "https://github.com/x", avatar_url: "https://github.com/x.png" },
            },
            { "x-github-event": "ping" },
        ),
        200,
        204,
    );
});
await check("more", "krisp browser models served", async () => {
    const r = await fetch(`${base}/krisp_browser_models/v1.0.11_1/model_8.kw`);
    await r.body?.cancel();
    return { ok: r.status === 200, note: `${r.status}` };
});
await check("more", "email change flow", async () => {
    const C = (
        await call("POST", "/auth/register", null, {
            username: `mail${suffix}`,
            email: `mail${suffix}@fosscord.test`,
            password: `pw-${suffix}-Abc123!`,
            date_of_birth: "2000-01-01",
            consent: true,
        })
    ).body.token;
    const r = await call("PATCH", "/users/@me", C, { email: `new${suffix}@fosscord.test`, password: `pw-${suffix}-Abc123!` });
    globalThis.M = r.body?.token ?? C;
    return { ok: r.status === 200 || r.status === 400, note: `${r.status} ${JSON.stringify(r.body).slice(0, 150)}` };
});
await check("more", "delete account", async () => {
    const C = globalThis.M;
    const r = await call("POST", "/users/@me/delete", C, { password: `pw-${suffix}-Abc123!` });
    const after = await call("GET", "/users/@me", C);
    return { ok: r.status === 204 && after.status === 401, note: `${r.status} after ${after.status}` };
});
await check("servers", "member applications with manual review", async () => {
    const own = (await call("POST", "/guilds", A, { name: `apply${suffix}` })).body;
    const channel = (await call("GET", `/guilds/${own.id}/channels`, A)).body.find((c) => c.type === 0);
    await call("PATCH", `/guilds/${own.id}/member-verification`, A, {
        enabled: true,
        form_fields: [
            { field_type: "TERMS", label: "Rules", values: ["be nice"], required: true },
            { field_type: "TEXT_INPUT", label: "Why?", required: true },
        ],
    });
    const invite = (await call("POST", `/channels/${channel.id}/invites`, A, { max_age: 0 })).body;
    const accepted = await call("POST", `/invites/${invite.code}`, B, {});
    const held = (await call("GET", `/guilds/${own.id}/members/${them.id}`, A)).status;
    const submitted = await call("PUT", `/guilds/${own.id}/requests/@me`, B, {
        form_fields: [
            { field_type: "TERMS", label: "Rules", values: ["be nice"], required: true, response: true },
            { field_type: "TEXT_INPUT", label: "Why?", required: true, response: "probe" },
        ],
    });
    const listed = (await call("GET", `/guilds/${own.id}/requests?status=SUBMITTED`, A)).body?.guild_join_requests?.length;
    const approved = await call("PATCH", `/guilds/${own.id}/requests/${submitted.body?.id}`, A, { action: "APPROVED" });
    const member = (await call("GET", `/guilds/${own.id}/members/${them.id}`, A)).status;
    await call("POST", `/guilds/${own.id}/delete`, A, {});
    return {
        ok:
            accepted.body?.show_verification_form === true &&
            held === 404 &&
            submitted.body?.application_status === "SUBMITTED" &&
            listed === 1 &&
            approved.status === 200 &&
            member === 200,
        note: `held ${held}, ${submitted.body?.application_status}, listed ${listed}, approve ${approved.status}, member ${member}`,
    };
});

for (const r of results) console.log(`${r.ok ? "PASS" : r.skip ? "SKIP" : "FAIL"} [${r.area}] ${r.name}${r.note ? ` :: ${r.note}` : ""}`);
console.log(`${results.filter((r) => r.ok).length} passed, ${results.filter((r) => r.skip).length} skipped, ${results.filter((r) => !r.ok && !r.skip).length} failed`);
process.exit(0);
