import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const api = `http://localhost:${process.env.PORT || 3001}/api/v9`;
const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", ...(token && { authorization: token }) }, body: body && JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) console.warn(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
};

const testPassword = randomBytes(12).toString("hex");
const friendPassword = randomBytes(12).toString("hex");
const { token } = await call("POST", "/auth/register", null, { email: "tester@fosscord.test", username: "tester", password: testPassword, date_of_birth: "2000-01-01", consent: true });
const friend = await call("POST", "/auth/register", null, { email: "friend@fosscord.test", username: "friend", password: friendPassword, date_of_birth: "2000-01-01", consent: true });
const me = await call("GET", "/users/@me", token);
const them = await call("GET", "/users/@me", friend.token);

await call("PUT", `/users/@me/relationships/${them.id}`, token, {});
await call("PUT", `/users/@me/relationships/${me.id}`, friend.token, {});
const dm = await call("POST", "/users/@me/channels", token, { recipients: [them.id] });
await call("POST", `/channels/${dm.id}/messages`, friend.token, { content: "hey! this is a dm from the seed script" });

const guild = await call("POST", "/guilds", token, { name: "Test Guild" });
const channels = await call("GET", `/guilds/${guild.id}/channels`, token);
const text = channels.find((c) => c.type === 0);
const invite = await call("POST", `/channels/${text.id}/invites`, token, {});
await call("POST", `/invites/${invite.code}`, friend.token, {});
for (const content of ["hello world", "**bold** _italic_ `code` ||spoiler||", "https://example.com", "> quote\n- list item"]) await call("POST", `/channels/${text.id}/messages`, token, { content });
await call("POST", `/channels/${text.id}/messages`, friend.token, { content: `hi <@${me.id}>` });
writeFileSync(new URL("./.test-account", import.meta.url), `TEST_EMAIL=tester@fosscord.test\nTEST_PASSWORD=${testPassword}\nFRIEND_PASSWORD=${friendPassword}\n`);
console.log(JSON.stringify({ guild: guild.id, channel: text.id, dm: dm.id, invite: invite.code }));
