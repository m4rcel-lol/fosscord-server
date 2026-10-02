import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const runs = Number(flag("runs", "20"));
const pid =
    flag("pid") ??
    execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"])
        .toString()
        .trim()
        .split("\n")[0];
const cpuMs = () => {
    const [rest, seconds] = execFileSync("ps", ["-o", "time=", "-p", pid]).toString().trim().split(".");
    const parts = rest.split(":").map(Number);
    return (parts.reduce((a, b) => a * 60 + b, 0) + Number(`0.${seconds}`)) * 1000;
};
const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);
const { token } = await fetch(`http://localhost:${port}/api/v9/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD }),
}).then((r) => r.json());

const identify = (compress) =>
    new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/?encoding=json&v=9${compress ? `&compress=${compress}` : ""}`, {
            headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" },
        });
        let sent = 0;
        let frames = 0;
        ws.on("message", (data) => {
            frames++;
            if (frames === 1) {
                sent = performance.now();
                ws.send(
                    JSON.stringify({
                        op: 2,
                        d: {
                            token,
                            capabilities: 30717,
                            properties: { os: "Linux", browser: "Chrome" },
                            presence: { status: "online", activities: [], afk: false, since: 0 },
                            compress: false,
                            client_state: { guild_versions: {} },
                        },
                    }),
                );
                return;
            }
            if (data.length < 500) return;
            const ms = performance.now() - sent;
            ws.close();
            resolve({ ms, bytes: data.length });
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 15000);
    });

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const out = {};
for (const compress of ["", "zlib-stream", "zstd-stream"]) {
    const results = [];
    await identify(compress);
    const cpuBefore = cpuMs();
    for (let i = 0; i < runs; i++) results.push(await identify(compress));
    const cpuPerIdentify = Math.round(((cpuMs() - cpuBefore) / runs) * 10) / 10;
    out[compress || "none"] = {
        medianMs: Math.round(median(results.map((r) => r.ms)) * 10) / 10,
        p90Ms: Math.round([...results.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(runs * 0.9)] * 10) / 10,
        serverCpuMs: cpuPerIdentify,
        readyBytes: results[0].bytes,
    };
}
console.log(JSON.stringify(out, null, 2));
