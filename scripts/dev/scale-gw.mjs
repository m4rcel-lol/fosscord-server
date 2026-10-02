import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const port = process.env.PORT || "3001";
const { tester, users } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const token = process.env.USER_INDEX ? users[Number(process.env.USER_INDEX)].token : tester.token;
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const identify = (watchMs) =>
    new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}/?encoding=json&v=9`, { headers: { "user-agent": userAgent } });
        const seen = { ready: false, frames: [], close: undefined };
        ws.on("message", (raw) => {
            const payload = JSON.parse(raw.toString());
            if (payload.op === 10)
                ws.send(JSON.stringify({ op: 2, d: { token, capabilities: 30717, properties: { os: "Linux", browser: "Chrome" }, presence: { status: "online", activities: [], afk: false, since: 0 }, compress: false } }));
            if (payload.t === "READY") {
                seen.ready = true;
                seen.user_id = payload.d.user.id;
                if (!watchMs) ws.close(1000);
                else setTimeout(() => ws.close(1000), watchMs);
            }
            if (seen.ready && payload.op === 0 && payload.t !== "READY") seen.frames.push({ t: payload.t, bytes: raw.length, d: payload.d });
            if (payload.op === 9) seen.invalid = true;
        });
        ws.on("close", (code) => resolve({ ...seen, close: code }));
        ws.on("error", () => {});
    });

const mode = process.argv[2] ?? "burst";
if (mode === "burst") {
    const runs = Number(process.env.RUNS || 30);
    const results = { ready: 0, rateLimited: 0, other: {} };
    for (let i = 0; i < runs; i++) {
        const result = await identify(0);
        if (result.ready) results.ready++;
        else if (result.close === 4008) results.rateLimited++;
        else results.other[result.close] = (results.other[result.close] ?? 0) + 1;
    }
    console.log(JSON.stringify(results));
}
if (mode === "presence") {
    const result = await identify(Number(process.env.WATCH || 3000));
    const own = result.frames.filter((x) => x.t === "PRESENCE_UPDATE" && x.d.user?.id === result.user_id);
    const others = result.frames.filter((x) => x.t === "PRESENCE_UPDATE" && x.d.user?.id !== result.user_id);
    console.log(JSON.stringify({ own: own.length, ownBytes: own.reduce((a, x) => a + x.bytes, 0), others: others.length, sample: others[0]?.d ?? own[0]?.d }));
}
