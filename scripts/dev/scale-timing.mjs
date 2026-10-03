import { readFileSync } from "node:fs";

const { tester } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const api = `http://localhost:${process.env.PORT || 3001}/api/v9`;
const runs = Number(process.env.RUNS || 3);
for (const path of process.argv.slice(2)) {
    const times = [];
    let summary;
    for (let i = 0; i < runs; i++) {
        const started = performance.now();
        const res = await fetch(`${api}${path}`, { headers: { authorization: tester.token } });
        const text = await res.text();
        times.push(Math.round(performance.now() - started));
        summary = `${res.status} ${text.length}B${text.startsWith("[") ? ` ${JSON.parse(text).length} items` : ` ${text.slice(0, 120)}`}`;
    }
    console.log(`${path} -> ${summary} ${times.join("/")} ms`);
}
