import { openSync, readFileSync, readSync, statSync, closeSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const runs = Number(flag("runs", "20"));
const trace = args.includes("--trace");
const only = flag("only");
const api = `http://localhost:${port}/api/v9`;
const logPath = process.env.SERVER_LOG || new URL("../../server.log", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);

const call = async (method, path, token, body) => {
    for (;;) {
        const started = performance.now();
        const res = await fetch(`${api}${path}`, {
            method,
            headers: { ...(body && { "content-type": "application/json" }), ...(token && { authorization: token }) },
            body: body && JSON.stringify(body),
        });
        const text = await res.text();
        const ms = performance.now() - started;
        if (res.status === 429) {
            await sleep(Math.ceil((JSON.parse(text).retry_after ?? 1) * 1000) + 50);
            continue;
        }
        if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
        return { body: text ? JSON.parse(text) : null, ms };
    }
};

const logSize = () => statSync(logPath).size;
const readLog = (from) => {
    const size = logSize();
    const buffer = Buffer.alloc(size - from);
    const fd = openSync(logPath, "r");
    readSync(fd, buffer, 0, buffer.length, from);
    closeSync(fd);
    return buffer.toString("utf8");
};
const settle = async () => {
    let size = logSize();
    for (;;) {
        await sleep(150);
        const next = logSize();
        if (next === size) return;
        size = next;
    }
};
const queriesIn = (text) => text.split("\n").filter((line) => /^query( failed)?:/.test(line));

const login = async (login, password) => (await call("POST", "/auth/login", null, { login, password })).body.token;
const tester = await login(accounts.TEST_EMAIL, accounts.TEST_PASSWORD);
const friend = await login("friend@fosscord.test", accounts.FRIEND_PASSWORD);
const friendUser = (await call("GET", "/users/@me", friend)).body;
const dms = (await call("GET", "/users/@me/channels", tester)).body;
const dm = dms.find((c) => c.type === 1 && c.recipients?.some((r) => r.id === friendUser.id));
const guilds = (await call("GET", "/users/@me/guilds", tester)).body;
const guildChannels = (await call("GET", `/guilds/${guilds[0].id}/channels`, tester)).body;
const text = guildChannels.find((c) => c.type === 0);
if (!dm || !text) throw new Error("run scripts/dev/seed.mjs first");

let n = 0;
let lastGuildMessage;
const testerUser = (await call("GET", "/users/@me", tester)).body;
const scenarios = {
    "POST dm": () => call("POST", `/channels/${dm.id}/messages`, tester, { content: `perf dm ${++n}`, nonce: `${Date.now()}${n}` }),
    "POST guild owner": async () => {
        const res = await call("POST", `/channels/${text.id}/messages`, tester, { content: `perf guild ${++n}`, nonce: `${Date.now()}${n}` });
        lastGuildMessage = res.body.id;
        return res;
    },
    "POST guild member": () => call("POST", `/channels/${text.id}/messages`, friend, { content: `perf guild ${++n}`, nonce: `${Date.now()}${n}` }),
    "POST guild mention": () => call("POST", `/channels/${text.id}/messages`, friend, { content: `perf <@${testerUser.id}> ${++n}`, nonce: `${Date.now()}${n}` }),
    "POST guild reply": () => call("POST", `/channels/${text.id}/messages`, friend, { content: `perf reply ${++n}`, message_reference: { message_id: lastGuildMessage } }),
    "GET dm": () => call("GET", `/channels/${dm.id}/messages?limit=50`, tester),
    "GET guild owner": () => call("GET", `/channels/${text.id}/messages?limit=50`, tester),
    "GET guild member": () => call("GET", `/channels/${text.id}/messages?limit=50`, friend),
};

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

for (const fn of Object.values(scenarios)) await fn();
await settle();

const rows = [];
for (const [name, fn] of Object.entries(scenarios)) {
    if (only && !name.includes(only)) continue;
    const counts = [];
    const times = [];
    let sample;
    for (let i = 0; i < runs; i++) {
        await settle();
        const from = logSize();
        const { ms } = await fn();
        await settle();
        const lines = queriesIn(readLog(from));
        counts.push(lines.length);
        times.push(ms);
        sample ??= lines;
    }
    rows.push({ name, queries: percentile(counts, 0.5), min: Math.min(...counts), max: Math.max(...counts), p50: percentile(times, 0.5), p90: percentile(times, 0.9) });
    if (trace) {
        console.log(`\n${name}: ${sample.length} queries`);
        sample.forEach((line, i) => console.log(`${String(i + 1).padStart(3)} ${line.replace(/ -- PARAMETERS: .*/, "").slice(0, 400)}`));
    }
}

console.log(`\n${"scenario".padEnd(20)} ${"queries".padStart(8)} ${"min".padStart(5)} ${"max".padStart(5)} ${"p50 ms".padStart(8)} ${"p90 ms".padStart(8)}`);
for (const r of rows)
    console.log(
        `${r.name.padEnd(20)} ${String(r.queries).padStart(8)} ${String(r.min).padStart(5)} ${String(r.max).padStart(5)} ${r.p50.toFixed(1).padStart(8)} ${r.p90.toFixed(1).padStart(8)}`,
    );
console.log(`\n${runs} runs per scenario, queries counted from DB_LOGGING output in ${logPath}`);
