import { readFileSync } from "node:fs";

const [method, path, body] = process.argv.slice(2);
const { tester } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const count = Number(process.env.N || 10);
const api = `http://localhost:${process.env.PORT || 3001}/api/v9`;
const anonymous = !!process.env.ANON;
const statuses = [];
for (let i = 0; i < count; i++) {
    const res = await fetch(`${api}${path}`, {
        method,
        headers: { ...(!anonymous && { authorization: tester.token }), ...(body && { "content-type": "application/json" }) },
        body: body?.replaceAll("{i}", `${Date.now()}${i}`),
    });
    statuses.push(res.status === 429 ? `429(${(await res.json()).retry_after})` : res.status);
}
console.log(statuses.join(" "));
