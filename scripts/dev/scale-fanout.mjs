import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const port = process.env.PORT || "3001";
const count = Number(process.env.N || 25);
const { guild, general, users } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const pid = execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"]).toString().trim().split("\n")[0];
const cpuMs = () => {
    const [rest, seconds] = execFileSync("ps", ["-o", "time=", "-p", pid]).toString().trim().split(".");
    return (rest.split(":").map(Number).reduce((a, b) => a * 60 + b, 0) + Number(`0.${seconds}`)) * 1000;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { frames: 0, bytes: 0, listBytes: 0, listFrames: 0, ops: {}, presenceBytes: 0, presenceFrames: 0 };
const reset = () => Object.assign(stats, { frames: 0, bytes: 0, listBytes: 0, listFrames: 0, ops: {}, presenceBytes: 0, presenceFrames: 0 });

const connect = (token, ranges) =>
    new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/?encoding=json&v=9`, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" } });
        ws.on("message", (raw) => {
            const payload = JSON.parse(raw.toString());
            stats.frames++;
            stats.bytes += raw.length;
            if (payload.op === 10) {
                ws.send(JSON.stringify({ op: 2, d: { token, capabilities: 30717, properties: { os: "Linux", browser: "Chrome" }, presence: { status: "online", activities: [], afk: false, since: 0 }, compress: false } }));
                setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 1, d: null })), payload.d.heartbeat_interval).unref();
            }
            if (payload.t === "READY") {
                ws.send(JSON.stringify({ op: 14, d: { guild_id: guild, channels: { [general]: ranges } } }));
            }
            if (payload.t === "GUILD_MEMBER_LIST_UPDATE") {
                stats.listBytes += raw.length;
                stats.listFrames++;
                for (const op of payload.d.ops) stats.ops[op.op] = (stats.ops[op.op] ?? 0) + 1;
                if (!ws.synced) {
                    ws.synced = true;
                    resolve(ws);
                }
            }
            if (payload.t === "PRESENCE_UPDATE") {
                stats.presenceBytes += raw.length;
                stats.presenceFrames++;
            }
        });
        ws.on("error", reject);
        ws.on("close", (code) => ws.synced || reject(new Error(`closed ${code}`)));
    });

const mode = process.argv[2] ?? "presence";
if (mode === "ranges") {
    const ws = await connect(users[0].token, [[0, 9999], [0, 9999], [0, 9999], [0, 9999], [0, 9999]]);
    await sleep(500);
    console.log("huge ranges", JSON.stringify(stats));
    reset();
    const before = cpuMs();
    const closed = new Promise((r) => ws.on("close", (code) => r(code)));
    for (let i = 0; i < 500; i++) ws.send(JSON.stringify({ op: 14, d: { guild_id: guild, channels: { [general]: [[0, 99]] } } }));
    console.log("flood closed with", await closed, "listFrames", stats.listFrames);
    await sleep(3000);
    console.log("server cpu during flood and 3 s after", Math.round(cpuMs() - before), "ms");
    process.exit(0);
}

const sockets = [];
for (const { token } of users.slice(0, count)) sockets.push(await connect(token, [[0, 99]]));
await sleep(1500);
console.log(`connected ${sockets.length}, initial`, JSON.stringify(stats));
reset();
let before = cpuMs();
sockets[0].send(JSON.stringify({ op: 3, d: { status: "dnd", since: 0, activities: [], afk: false } }));
await sleep(2000);
console.log("status dnd", JSON.stringify(stats), "cpu", Math.round(cpuMs() - before), "ms");
reset();
before = cpuMs();
await fetch(`http://localhost:${port}/api/v9/guilds/${guild}/members/@me`, {
    method: "PATCH",
    headers: { authorization: users[1].token, "content-type": "application/json" },
    body: JSON.stringify({ nick: `nick ${Date.now()}` }),
});
await sleep(2000);
console.log("nick change", JSON.stringify(stats), "cpu", Math.round(cpuMs() - before), "ms");
reset();
before = cpuMs();
sockets.at(-1).close();
await sleep(2000);
console.log("one socket closed", JSON.stringify(stats), "cpu", Math.round(cpuMs() - before), "ms");
process.exit(0);
