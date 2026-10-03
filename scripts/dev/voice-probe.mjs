import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const port = flag("port", process.env.PORT || "3001");
const wait = Number(flag("wait", "10")) * 1000;
const executablePath = flag("browser");
const video = has("video");
const dropVoice = has("drop-voice");
const origin = `http://fosscord.localhost:${port}`;
const api = `http://localhost:${port}/api/v9`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);
const users = {
    tester: { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD },
    friend: { login: "friend@fosscord.test", password: accounts.FRIEND_PASSWORD },
};
const call = async (token, method, path, body) =>
    fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", ...(token && { authorization: token }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
const tokens = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([name, body]) => [name, (await call(undefined, "POST", "/auth/login", body)).token])));

const friendGuilds = new Set((await call(tokens.friend, "GET", "/users/@me/guilds")).map((g) => g.id));
const guild = (await call(tokens.tester, "GET", "/users/@me/guilds")).find((g) => friendGuilds.has(g.id));
if (!guild) throw new Error("tester and friend share no guild");
const channels = await call(tokens.tester, "GET", `/guilds/${guild.id}/channels`);
const voice = channels.find((c) => c.type === 2) ?? (await call(tokens.tester, "POST", `/guilds/${guild.id}/channels`, { name: "General", type: 2 }));

const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

const pages = {};
for (const [name, token] of Object.entries(tokens)) {
    const context = await browser.newContext({ permissions: ["microphone", "camera"] });
    await context.addInitScript((value) => {
        localStorage.setItem("token", JSON.stringify(value));
        window.__pcs = [];
        window.__voiceSockets = [];
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(Native, {
            construct(target, ctorArgs) {
                const pc = new target(...ctorArgs);
                window.__pcs.push(pc);
                return pc;
            },
        });
        const NativeSocket = window.WebSocket;
        window.WebSocket = new Proxy(NativeSocket, {
            construct(target, ctorArgs) {
                const socket = new target(...ctorArgs);
                if (String(ctorArgs[0]).includes("encoding=")) return socket;
                const entry = { socket, ops: [], closed: null };
                window.__voiceSockets.push(entry);
                socket.addEventListener("message", (event) => {
                    if (typeof event.data === "string") entry.ops.push(JSON.parse(event.data).op);
                    else if (event.data instanceof ArrayBuffer) entry.ops.push(new Uint8Array(event.data)[2]);
                });
                socket.addEventListener("close", (event) => (entry.closed = event.code));
                return socket;
            },
        });
    }, token);
    await context.route(/^https:\/\/([a-z0-9-]+\.)*(discord|discordapp)\.(com|net|media|gg)\//, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me`);
    pages[name] = page;
}
await sleep(15000);

const invoke = (page, needle, method, arg) =>
    page.evaluate(
        ([needle, method, arg]) => {
            const requires = [];
            window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
            for (const req of requires)
                for (const mid of Object.keys(req.m)) {
                    if (!req.m[mid].toString().includes(needle)) continue;
                    const exports = req(mid);
                    for (const key of Object.keys(exports))
                        if (typeof exports[key]?.[method] === "function") {
                            exports[key][method](arg);
                            return true;
                        }
                }
            return false;
        },
        [needle, method, arg],
    );

const stats = (page) =>
    page.evaluate(async () => {
        const rows = [];
        for (const pc of window.__pcs) {
            if (pc.connectionState === "closed") continue;
            (await pc.getStats()).forEach((r) => {
                if (r.type === "inbound-rtp" && r.bytesReceived)
                    rows.push({
                        dir: "in",
                        kind: r.kind,
                        ssrc: r.ssrc,
                        bytes: r.bytesReceived,
                        packets: r.packetsReceived,
                        lost: r.packetsLost,
                        nacksSent: r.nackCount,
                        framesDecoded: r.framesDecoded,
                        keyFrames: r.keyFramesDecoded,
                        plisSent: r.pliCount,
                        fps: r.framesPerSecond,
                        freezes: r.freezeCount,
                        freezeSeconds: r.totalFreezesDuration,
                        width: r.frameWidth,
                    });
                if (r.type === "outbound-rtp" && r.bytesSent)
                    rows.push({
                        dir: "out",
                        kind: r.kind,
                        ssrc: r.ssrc,
                        bytes: r.bytesSent,
                        packets: r.packetsSent,
                        nacksReceived: r.nackCount,
                        retransmitted: r.retransmittedPacketsSent,
                        targetBitrate: r.targetBitrate,
                        width: r.frameWidth,
                    });
            });
        }
        return rows;
    });

const sockets = (page) =>
    page.evaluate(() => ({
        peerConnections: window.__pcs.filter((pc) => pc.connectionState !== "closed").map((pc) => pc.connectionState),
        voiceSockets: window.__voiceSockets.map((entry) => ({ url: entry.socket.url, closed: entry.closed, ops: entry.ops.filter((op) => ![6].includes(op)) })),
    }));

const report = async (label) => {
    for (const [name, page] of Object.entries(pages)) console.log(JSON.stringify({ label, user: name, channel: voice.name, media: await stats(page) }));
};

await invoke(pages.tester, "selectVoiceChannel(e){", "selectVoiceChannel", voice.id);
await sleep(3000);
await invoke(pages.friend, "selectVoiceChannel(e){", "selectVoiceChannel", voice.id);
await sleep(3000);
if (video) await invoke(pages.tester, "setVideoEnabled(e){", "setVideoEnabled", true);
await sleep(wait);
await report("connected");

if (dropVoice) {
    const before = await sockets(pages.tester);
    await pages.tester.evaluate(() => window.__voiceSockets.at(-1).socket.close(4000));
    const friendVideo = has("video-during-drop") && (await invoke(pages.friend, "setVideoEnabled(e){", "setVideoEnabled", true));
    await sleep(Number(flag("resume-wait", "8")) * 1000);
    const after = await sockets(pages.tester);
    const friendSockets = await sockets(pages.friend);
    const resumedSocket = after.voiceSockets.at(-1);
    console.log(
        JSON.stringify({
            label: "voice-drop",
            peerConnectionsBefore: before.peerConnections,
            peerConnectionsAfter: after.peerConnections,
            socketsBefore: before.voiceSockets.length,
            socketsAfter: after.voiceSockets.length,
            resumedSocketOps: resumedSocket?.ops,
            gotResumed: resumedSocket?.ops.includes(9) ?? false,
            reidentified: resumedSocket?.ops.includes(2) ?? false,
            friendSawDisconnect: friendSockets.voiceSockets.some((entry) => entry.ops.includes(13)),
            friendVideo,
        }),
    );
    await sleep(wait);
    await report("after-resume");
}

if (has("leave")) {
    const startedAt = Date.now();
    await invoke(pages.tester, "selectVoiceChannel(e){", "selectVoiceChannel", null);
    let seenAfter = null;
    while (Date.now() - startedAt < 10000 && seenAfter === null) {
        if ((await sockets(pages.friend)).voiceSockets.some((entry) => entry.ops.includes(13))) seenAfter = Date.now() - startedAt;
        else await sleep(100);
    }
    console.log(JSON.stringify({ label: "leave", friendSawDisconnectAfterMs: seenAfter }));
}

await browser.close();
