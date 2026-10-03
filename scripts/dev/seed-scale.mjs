import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const root = new URL("../../", import.meta.url);
const env = Object.fromEntries(
    readFileSync(new URL(".env", root), "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const members = Number(process.env.MEMBERS || 200);
const messages = Number(process.env.MESSAGES || 5000);
const api = `http://localhost:${process.env.PORT || env.PORT}/api/v9`;
const key = createPrivateKey(readFileSync(new URL("jwt.key", root)));
const sign = (id) => jwt.sign({ id, iat: Math.floor(Date.now() / 1000), ver: 3 }, key, { algorithm: "ES512" });

const db = new Client({ connectionString: process.env.DATABASE || env.DATABASE });
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

const tester = await one(`SELECT id FROM users WHERE username = 'tester'`);
const friend = await one(`SELECT * FROM users WHERE username = 'friend'`);
if (!tester || !friend) throw new Error("run scripts/dev/seed.mjs first");
const testerToken = sign(tester.id);

const call = async (method, path, body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: testerToken }, body: body && JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
};

const guild = await call("POST", "/guilds", { name: "Scale Guild" });
const general = (await call("GET", `/guilds/${guild.id}/channels`)).find((c) => c.type === 0);

let next = BigInt(guild.id) + 10n ** 14n + BigInt(Math.floor(Math.random() * 1e6)) * 100000n;
const id = () => (next++).toString();

const settingsBase = await one(`SELECT * FROM user_settings WHERE index = $1`, [friend.settingsIndex]);
const settingsColumns = Object.keys(settingsBase)
    .filter((c) => c !== "index")
    .map((c) => `"${c}"`)
    .join(",");
const userIds = Array.from({ length: members }, id);
await db.query("BEGIN");
for (const [i, userId] of userIds.entries()) {
    const settings = await one(`INSERT INTO user_settings (${settingsColumns}) SELECT ${settingsColumns} FROM json_populate_record(null::user_settings, $1) RETURNING index`, [
        JSON.stringify(settingsBase),
    ]);
    await db.query(`INSERT INTO users SELECT (json_populate_record(null::users, $1)).*`, [
        JSON.stringify({ ...friend, id: userId, username: `scale${i}`, email: `scale${i}@fosscord.test`, discriminator: String(i % 10000).padStart(4, "0"), settingsIndex: settings.index }),
    ]);
    const member = await one(
        `INSERT INTO members (id, guild_id, joined_at, deaf, mute, pending, settings, bio, flags) VALUES ($1, $2, now(), false, false, false, '{}', '', 0) RETURNING index`,
        [userId, guild.id],
    );
    await db.query(`INSERT INTO member_roles (index, role_id) VALUES ($1, $2)`, [member.index, guild.id]);
}
await db.query(`UPDATE guilds SET member_count = member_count + $1 WHERE id = $2`, [members, guild.id]);
const authors = [tester.id, ...userIds.slice(0, 20)];
const start = Date.now() - messages * 60_000;
for (let i = 0; i < messages; i += 1000) {
    const batch = Array.from({ length: Math.min(1000, messages - i) }, (_, j) => ({ n: i + j, id: (((BigInt(start + (i + j) * 60_000) - 1420070400000n) << 22n) + BigInt(j)).toString() }));
    await db.query(
        `INSERT INTO messages (id, channel_id, guild_id, author_id, member_id, content, timestamp, embeds, reactions, type, flags, message_snapshots)
         SELECT (x->>'id')::bigint, $1, $2, (x->>'author')::bigint, (x->>'author')::bigint, x->>'content', to_timestamp((x->>'ts')::double precision / 1000), '[]', '[]', 0, 0, '[]'
         FROM json_array_elements($3) x`,
        [general.id, guild.id, JSON.stringify(batch.map(({ n, id }) => ({ id, author: authors[n % authors.length], content: `scale message ${n}`, ts: start + n * 60_000 })))],
    );
}
await db.query(`UPDATE channels SET last_message_id = (SELECT max(id) FROM messages WHERE channel_id = $1) WHERE id = $1`, [general.id]);
await db.query("COMMIT");
await db.end();

const tokens = userIds.map((userId) => ({ id: userId, token: sign(userId) }));
writeFileSync(new URL("scripts/dev/.scale-tokens.json", root), JSON.stringify({ guild: guild.id, general: general.id, tester: { id: tester.id, token: testerToken }, users: tokens }));
console.log(JSON.stringify({ guild: guild.id, general: general.id, members, messages }));
