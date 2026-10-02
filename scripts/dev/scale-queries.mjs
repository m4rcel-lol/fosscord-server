import { readFileSync } from "node:fs";

const { tester } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const api = `http://localhost:${process.env.PORT || 3001}/api/v9`;
const log = new URL("../../server.log", import.meta.url);
const queries = () => readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("query")).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const path of process.argv.slice(2)) {
    const before = queries();
    const started = performance.now();
    const res = await fetch(`${api}${path}`, { headers: { authorization: tester.token } });
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    await sleep(300);
    console.log(`${path} -> ${res.status} ${text.length}B in ${ms} ms, ${queries() - before} queries`);
}
