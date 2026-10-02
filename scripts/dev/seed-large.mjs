import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(args[i + 1]);
};
const counts = {
    guilds: flag("guilds", 100),
    channels: flag("channels", 50),
    roles: flag("roles", 40),
    emojis: flag("emojis", 50),
    stickers: flag("stickers", 5),
    memberRoles: flag("member-roles", 5),
};
const env = Object.fromEntries(
    readFileSync(new URL("../../.env", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = new Client({ connectionString: process.env.DATABASE || env.DATABASE });
await db.connect();

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const insert = async (table, rows) => {
    if (!rows.length) return;
    const columns = Object.keys(rows[0])
        .map((c) => `"${c}"`)
        .join(", ");
    for (let i = 0; i < rows.length; i += 2000)
        await db.query(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM json_populate_recordset(null::"${table}", $1)`, [JSON.stringify(rows.slice(i, i + 2000))]);
};

const tester = await one(`SELECT id FROM users WHERE username = 'tester'`);
const friend = await one(`SELECT id FROM users WHERE username = 'friend'`);
const template = await one(`SELECT * FROM guilds WHERE name = 'Test Guild' ORDER BY id LIMIT 1`);
if (!tester || !template) throw new Error("run scripts/dev/seed.mjs first");
const text = await one(`SELECT * FROM channels WHERE guild_id = $1 AND type = 0 LIMIT 1`, [template.id]);
const category = await one(`SELECT * FROM channels WHERE guild_id = $1 AND type = 4 LIMIT 1`, [template.id]);
const everyone = await one(`SELECT * FROM roles WHERE id = $1`, [template.id]);
const members = (await db.query(`SELECT * FROM members WHERE guild_id = $1`, [template.id])).rows;

let next = BigInt(template.id) + 10n ** 15n + BigInt(Math.floor(Math.random() * 1e9)) * 1000n;
const id = () => (next++).toString();

const rows = { guilds: [], channels: [], roles: [], emojis: [], stickers: [], members: [], read_states: [] };
const started = Date.now();
for (let g = 0; g < counts.guilds; g++) {
    const guildId = id();
    const categoryId = id();
    const channelIds = Array.from({ length: counts.channels }, id);
    rows.guilds.push({
        ...template,
        id: guildId,
        name: `Large Guild ${g + 1}`,
        system_channel_id: channelIds[0],
        channel_ordering: [categoryId, ...channelIds],
        member_count: members.length,
    });
    rows.channels.push({ ...category, id: categoryId, guild_id: guildId, name: "Text Channels" });
    channelIds.forEach((channelId, i) =>
        rows.channels.push({
            ...text,
            id: channelId,
            guild_id: guildId,
            parent_id: categoryId,
            name: `channel-${i + 1}`,
            topic: `topic for channel ${i + 1}`,
            last_message_id: null,
        }),
    );
    const roleIds = Array.from({ length: counts.roles - 1 }, id);
    rows.roles.push({ ...everyone, id: guildId, guild_id: guildId });
    roleIds.forEach((roleId, i) =>
        rows.roles.push({ ...everyone, id: roleId, guild_id: guildId, name: `role ${i + 1}`, permissions: "0", position: i + 1, color: (i * 2654435761) & 0xffffff, hoist: i < 5 }),
    );
    for (let e = 0; e < counts.emojis; e++)
        rows.emojis.push({
            id: id(),
            guild_id: guildId,
            user_id: tester.id,
            name: `emoji_${e + 1}`,
            animated: e % 7 === 0,
            available: true,
            managed: false,
            require_colons: true,
            roles: [],
        });
    for (let s = 0; s < counts.stickers; s++)
        rows.stickers.push({ id: id(), guild_id: guildId, user_id: tester.id, name: `sticker ${s + 1}`, description: "", tags: "smile", available: true, type: 2, format_type: 1 });
    for (const member of members) {
        const { index, ...rest } = member;
        rows.members.push({ ...rest, guild_id: guildId, _roles: member.id === tester.id ? roleIds.slice(0, counts.memberRoles) : [] });
    }
    for (const channelId of channelIds.slice(0, 10))
        rows.read_states.push({ id: id(), channel_id: channelId, user_id: tester.id, last_message_id: null, mention_count: 0, badge_count: 0, read_state_type: 0, flags: 0 });
}

await db.query("BEGIN");
await insert(
    "guilds",
    rows.guilds.map((g) => ({ ...g, system_channel_id: null, afk_channel_id: null, rules_channel_id: null, public_updates_channel_id: null, widget_channel_id: null })),
);
await insert(
    "channels",
    rows.channels.map((c) => ({ ...c, parent_id: null })),
);
await db.query(`UPDATE guilds SET system_channel_id = v.channel::bigint FROM json_to_recordset($1) AS v(id text, channel text) WHERE guilds.id = v.id::bigint`, [
    JSON.stringify(rows.guilds.map((g) => ({ id: g.id, channel: g.system_channel_id }))),
]);
await db.query(`UPDATE channels SET parent_id = v.parent_id::bigint FROM json_to_recordset($1) AS v(id text, parent_id text) WHERE channels.id = v.id::bigint`, [
    JSON.stringify(rows.channels.filter((c) => c.parent_id).map(({ id, parent_id }) => ({ id, parent_id }))),
]);
await insert("roles", rows.roles);
await insert("emojis", rows.emojis);
await insert("stickers", rows.stickers);
const memberRoles = [];
for (let i = 0; i < rows.members.length; i += 2000) {
    const chunk = rows.members.slice(i, i + 2000);
    const columns = Object.keys(chunk[0])
        .filter((c) => c !== "_roles")
        .map((c) => `"${c}"`)
        .join(", ");
    const inserted = await db.query(`INSERT INTO members (${columns}) SELECT ${columns} FROM json_populate_recordset(null::members, $1) RETURNING index, id, guild_id`, [
        JSON.stringify(chunk.map(({ _roles, ...m }) => m)),
    ]);
    const byKey = new Map(chunk.map((m) => [`${m.id}:${m.guild_id}`, m._roles]));
    for (const { index, id: userId, guild_id } of inserted.rows) for (const role_id of byKey.get(`${userId}:${guild_id}`) ?? []) memberRoles.push({ index, role_id });
}
await insert("member_roles", memberRoles);
await insert("read_states", rows.read_states);
await db.query("COMMIT");
await db.end();
console.log(
    JSON.stringify({
        ...counts,
        members: rows.members.length,
        rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])),
        memberRoleRows: memberRoles.length,
        friend: !!friend,
        ms: Date.now() - started,
    }),
);
