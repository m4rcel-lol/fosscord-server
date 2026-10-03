import { readFileSync } from "node:fs";

const { general, tester, users } = JSON.parse(readFileSync(new URL("./.scale-tokens.json", import.meta.url), "utf8"));
const count = Number(process.env.N || 20);
const api = `http://localhost:${process.env.PORT || 3001}/api/v9`;
const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { authorization: token, ...(body && { "content-type": "application/json" }) }, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};
const race = async (method, path, body) => {
    const statuses = await Promise.all(users.slice(0, count).map(async ({ token }) => (await call(method, path, token, body)).status));
    return statuses.reduce((acc, status) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});
};

const mode = process.argv[2] ?? "reactions";
if (mode === "reactions") {
    const { body: message } = await call("POST", `/channels/${general}/messages`, tester.token, { content: "react to me" });
    for (const emoji of ["%F0%9F%94%A5", "%F0%9F%91%8D"]) console.log(emoji, await race("PUT", `/channels/${general}/messages/${message.id}/reactions/${emoji}/@me`));
    const { body: stored } = await call("GET", `/channels/${general}/messages?around=${message.id}&limit=1`, tester.token);
    console.log(JSON.stringify(stored[0].reactions.map((r) => [r.emoji.name, r.count])));
    console.log("remove", await race("DELETE", `/channels/${general}/messages/${message.id}/reactions/%F0%9F%94%A5/@me`));
    const { body: after } = await call("GET", `/channels/${general}/messages?around=${message.id}&limit=1`, tester.token);
    console.log(JSON.stringify(after[0].reactions.map((r) => [r.emoji.name, r.count])));
}
if (mode === "poll") {
    const { body: message } = await call("POST", `/channels/${general}/messages`, tester.token, {
        poll: { question: { text: "race?" }, answers: [{ poll_media: { text: "a" } }, { poll_media: { text: "b" } }], duration: 1, allow_multiselect: false },
    });
    console.log("vote", await race("PUT", `/channels/${general}/polls/${message.id}/answers/@me`, { answer_ids: ["1"] }));
    const { body: stored } = await call("GET", `/channels/${general}/messages?around=${message.id}&limit=1`, tester.token);
    console.log(JSON.stringify(stored[0].poll.results));
}
