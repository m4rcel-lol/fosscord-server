import { readFileSync, writeFileSync, existsSync } from "node:fs";

const port = process.env.PORT || "3001";
const api = `http://localhost:${port}/api/v9`;
const stateFile = new URL("./.test-bot", import.meta.url);

const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", ...(token && { authorization: token }) }, body: body && JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) console.warn(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
};

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);

const commands = [
    { name: "ping", description: "Replies with pong", integration_types: [0, 1], contexts: [0, 1, 2] },
    { name: "echo", description: "Repeats what you say", options: [{ type: 3, name: "text", description: "What to say", required: true }, { type: 5, name: "loud", description: "Shout it" }] },
    { name: "buttons", description: "Sends a message with buttons and a select menu" },
    { name: "secret", description: "Replies with an ephemeral message" },
    { name: "form", description: "Opens a modal" },
    { name: "defer", description: "Defers, then edits the reply and sends a followup" },
    { name: "v2", description: "Sends a Components V2 message" },
    { name: "fruit", description: "Pick a fruit with autocomplete", options: [{ type: 3, name: "name", description: "Fruit name", required: true, autocomplete: true }] },
    { name: "selects", description: "Sends user, role, channel and mentionable select menus" },
    { name: "upload", description: "Echoes an uploaded file", options: [{ type: 11, name: "file", description: "Any file", required: true }] },
    { name: "image", description: "Replies with an uploaded image and an embed" },
    { name: "gallery", description: "Sends a Components V2 message with media" },
    { name: "Wave", type: 2 },
    { name: "Quote", type: 3 },
];

const setup = async () => {
    const login = await call("POST", "/auth/login", null, { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD });
    const owner = login.token;
    const apps = await call("GET", "/applications", owner);
    const app = apps.find((a) => a.name === "Test Bot") || (await call("POST", "/applications", owner, { name: "Test Bot" }));
    if (!app.bot) await call("POST", `/applications/${app.id}/bot`, owner);
    const { token } = await call("POST", `/applications/${app.id}/bot/reset`, owner, {});
    const guilds = await call("GET", "/users/@me/guilds", owner);
    const guild = guilds.find((g) => g.name === "Test Guild");
    await call("POST", `/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands`, owner, { guild_id: guild.id, permissions: "8", authorize: true });
    const bot = `Bot ${token}`;
    await call("PUT", `/applications/${app.id}/commands`, bot, commands);
    await call("PUT", `/applications/${app.id}/guilds/${guild.id}/commands`, bot, [{ name: "guildonly", description: "A command registered only in this guild" }]);
    const state = { application_id: app.id, token, guild_id: guild.id };
    writeFileSync(stateFile, JSON.stringify(state));
    return state;
};

const state = process.argv.includes("--setup") || !existsSync(stateFile) ? await setup() : JSON.parse(readFileSync(stateFile, "utf8"));
console.log(JSON.stringify(state));
if (process.argv.includes("--setup-only")) process.exit(0);

const bot = `Bot ${state.token}`;
const respond = (i, body) => call("POST", `/interactions/${i.id}/${i.token}/callback`, null, body);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGNkYPjPQApgIkn1qIZRDaMaRjWMahjVMKphVMNQ0QAAHGQBH2wLs6wAAAAASUVORK5CYII=", "base64");
const respondWithFile = async (i, body, name, buffer) => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(body));
    form.append("files[0]", new Blob([buffer], { type: "image/png" }), name);
    const res = await fetch(`${api}/interactions/${i.id}/${i.token}/callback`, { method: "POST", body: form });
    if (!res.ok) console.warn(`file callback -> ${res.status} ${(await res.text()).slice(0, 300)}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const who = (i) => i.member?.user ?? i.user;

const buttonsMessage = (count = 0) => ({
    content: `clicked ${count} times`,
    components: [
        {
            type: 1,
            components: [
                { type: 2, style: 1, label: "Click me", custom_id: `count:${count}` },
                { type: 2, style: 3, label: "Green", custom_id: "green" },
                { type: 2, style: 4, label: "Danger", custom_id: "danger" },
                { type: 2, style: 5, label: "Link", url: "https://example.com" },
                { type: 2, style: 2, label: "Disabled", custom_id: "disabled", disabled: true },
            ],
        },
        {
            type: 1,
            components: [
                {
                    type: 3,
                    custom_id: "select",
                    placeholder: "Pick a colour",
                    options: [
                        { label: "Red", value: "red", description: "The colour red", emoji: { name: "🔴" } },
                        { label: "Blue", value: "blue" },
                        { label: "Green", value: "green" },
                    ],
                },
            ],
        },
    ],
});

const v2Message = {
    flags: 1 << 15,
    components: [
        {
            type: 17,
            accent_color: 0x5865f2,
            components: [
                { type: 10, content: "# Components V2\nThis message uses containers, sections and text displays." },
                {
                    type: 9,
                    components: [{ type: 10, content: "A section with a button accessory" }],
                    accessory: { type: 2, style: 1, label: "Press", custom_id: "v2press" },
                },
                { type: 14, divider: true, spacing: 1 },
                { type: 10, content: "-# small footer text" },
            ],
        },
    ],
};

const handlers = {
    ping: (i) => respond(i, { type: 4, data: { content: "pong!" } }),
    echo: (i) => {
        const opts = Object.fromEntries((i.data.options ?? []).map((o) => [o.name, o.value]));
        return respond(i, { type: 4, data: { content: opts.loud ? String(opts.text).toUpperCase() : String(opts.text) } });
    },
    buttons: (i) => respond(i, { type: 4, data: buttonsMessage() }),
    secret: (i) => respond(i, { type: 4, data: { content: "only you can see this", flags: 64 } }),
    form: (i) =>
        respond(i, {
            type: 9,
            data: {
                custom_id: "feedback",
                title: "Feedback",
                components: [
                    { type: 1, components: [{ type: 4, custom_id: "subject", label: "Subject", style: 1, required: true, placeholder: "One line" }] },
                    { type: 1, components: [{ type: 4, custom_id: "body", label: "Details", style: 2, required: false }] },
                ],
            },
        }),
    defer: async (i) => {
        await respond(i, { type: 5 });
        await wait(1500);
        await call("PATCH", `/webhooks/${state.application_id}/${i.token}/messages/@original`, null, { content: "deferred reply, edited after 1.5s" });
        await call("POST", `/webhooks/${state.application_id}/${i.token}`, null, { content: "and this is a followup" });
    },
    v2: (i) => respond(i, { type: 4, data: v2Message }),
    fruit: (i) => respond(i, { type: 4, data: { content: `you picked ${i.data.options[0].value}` } }),
    selects: (i) =>
        respond(i, {
            type: 4,
            data: {
                content: "pick some things",
                components: [
                    { type: 1, components: [{ type: 5, custom_id: "users", placeholder: "Pick users", max_values: 3 }] },
                    { type: 1, components: [{ type: 6, custom_id: "roles", placeholder: "Pick a role" }] },
                    { type: 1, components: [{ type: 8, custom_id: "channels", placeholder: "Pick a channel", channel_types: [0] }] },
                    { type: 1, components: [{ type: 7, custom_id: "mentionables", placeholder: "Pick anything" }] },
                ],
            },
        }),
    upload: (i) => {
        const attachment = Object.values(i.data.resolved?.attachments ?? {})[0];
        return respond(i, { type: 4, data: { content: attachment ? `got ${attachment.filename} (${attachment.size} bytes) ${attachment.url}` : "no attachment resolved" } });
    },
    image: (i) =>
        respondWithFile(
            i,
            { type: 4, data: { content: "here is a picture", embeds: [{ title: "Embedded attachment", image: { url: "attachment://square.png" } }], attachments: [{ id: 0, filename: "square.png" }] } },
            "square.png",
            png,
        ),
    gallery: (i) =>
        respondWithFile(
            i,
            {
                type: 4,
                data: {
                    flags: 1 << 15,
                    attachments: [{ id: 0, filename: "square.png" }],
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 9, components: [{ type: 10, content: "**Section with thumbnail**\nThumbnails sit on the right." }], accessory: { type: 11, media: { url: "attachment://square.png" } } },
                                { type: 12, items: [{ media: { url: "attachment://square.png" }, description: "a square" }] },
                                { type: 1, components: [{ type: 2, style: 2, label: "Secondary", custom_id: "v2secondary" }, { type: 2, style: 5, label: "Docs", url: "https://docs.discord.food" }] },
                            ],
                        },
                    ],
                },
            },
            "square.png",
            png,
        ),
    guildonly: (i) => respond(i, { type: 4, data: { content: "guild command works" } }),
    Wave: (i) => respond(i, { type: 4, data: { content: `${who(i).username} waves at <@${i.data.target_id}>` } }),
    Quote: (i) => respond(i, { type: 4, data: { content: `> ${i.data.resolved?.messages?.[i.data.target_id]?.content ?? "(missing message)"}` } }),
};

const onInteraction = async (i) => {
    console.log(`interaction type=${i.type} ${i.data?.name ?? i.data?.custom_id ?? ""}`);
    if (i.type === 2) return handlers[i.data.name]?.(i);
    if (i.type === 4) {
        const typed = String(i.data.options?.find((o) => o.focused)?.value ?? "").toLowerCase();
        const choices = ["apple", "banana", "cherry", "grape", "mango", "orange"].filter((f) => f.startsWith(typed)).map((f) => ({ name: f, value: f }));
        return respond(i, { type: 8, data: { choices } });
    }
    if (i.type === 3) {
        const id = i.data.custom_id;
        if (id.startsWith("count:")) return respond(i, { type: 7, data: buttonsMessage(Number(id.split(":")[1]) + 1) });
        if (["users", "roles", "channels", "mentionables"].includes(id)) {
            const names = Object.values({ ...i.data.resolved?.users, ...i.data.resolved?.roles, ...i.data.resolved?.channels }).map((x) => x.username ?? x.name);
            return respond(i, { type: 4, data: { content: `${id}: ${names.join(", ")}`, flags: 64 } });
        }
        if (id === "select") return respond(i, { type: 4, data: { content: `you picked ${i.data.values.join(", ")}`, flags: 64 } });
        if (id === "v2press") return respond(i, { type: 4, data: { content: "v2 button pressed", flags: 64 } });
        return respond(i, { type: 6 });
    }
    if (i.type === 5) {
        const fields = Object.fromEntries(i.data.components.flatMap((r) => r.components ?? [r.component]).map((c) => [c.custom_id, c.value]));
        return respond(i, { type: 4, data: { content: `thanks for the feedback: **${fields.subject}** ${fields.body ?? ""}` } });
    }
};

const connect = () => {
    const ws = new WebSocket(`ws://localhost:${port}/?v=9&encoding=json`);
    let heartbeat;
    let seq = null;
    ws.onmessage = ({ data }) => {
        const { op, t, d, s } = JSON.parse(data);
        if (s) seq = s;
        if (op === 10) {
            heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), d.heartbeat_interval);
            ws.send(JSON.stringify({ op: 2, d: { token: bot, intents: 33281, properties: { os: "linux", browser: "test-bot", device: "test-bot" } } }));
        }
        if (t === "READY") console.log(`ready as ${d.user.username}#${d.user.discriminator} in ${d.guilds.length} guilds`);
        if (t === "INTERACTION_CREATE") onInteraction(d).catch((e) => console.error(e));
    };
    ws.onclose = (e) => {
        clearInterval(heartbeat);
        console.log(`gateway closed ${e.code} ${e.reason}, reconnecting`);
        setTimeout(connect, 2000);
    };
};
connect();
