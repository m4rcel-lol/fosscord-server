import { createRequire } from "node:module";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const executablePath = flag("browser");
const serverLog = flag("server-log");
const shots = flag("shots");
const origin = `http://fosscord.localhost:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logStart = serverLog ? statSync(serverLog).size : 0;

const suffix = randomBytes(3).toString("hex");
const users = {
    A: { display: `Alice ${suffix}`, username: `alice_${suffix}`, password: randomBytes(12).toString("hex") },
    B: { display: `Bob ${suffix}`, username: `bob_${suffix}`, password: randomBytes(12).toString("hex") },
};
const fixture = `${process.env.TMPDIR || "/tmp"}/everyday-flow-${suffix}.txt`;
writeFileSync(fixture, "everyday flow upload\n");

const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

const issues = [];
const warnings = [];
const pages = {};
for (const name of ["A", "B"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", permissions: ["microphone", "camera"] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (e) => issues.push(`[${name}] pageerror ${String(e.stack || e).slice(0, 400)}`));
    page.on("console", (m) => {
        if (m.type() === "error") issues.push(`[${name}] console.error ${m.text().slice(0, 400)}`);
        else if (m.type() === "warning")
            warnings.push(
                `[${name}] ${m
                    .text()
                    .replace(/%c|\nfont-weight: bold;\ncolor: purple;\n/g, "")
                    .slice(0, 200)}`,
            );
    });
    page.on("response", (r) => r.status() >= 400 && issues.push(`[${name}] ${r.status()} ${r.request().method()} ${r.url().replace(origin, "")}`));
    page.on("requestfailed", (r) => {
        const error = r.failure()?.errorText;
        if (error !== "net::ERR_ABORTED") issues.push(`[${name}] FAILED ${r.method()} ${r.url().replace(origin, "")} ${error}`);
    });
    pages[name] = page;
}
const { A, B } = pages;

const steps = [];
const step = async (name, fn) => {
    if (steps.some((x) => !x.ok)) return void steps.push({ step: name, ok: false, error: "skipped" });
    const started = Date.now();
    try {
        await fn();
        steps.push({ step: name, ok: true, ms: Date.now() - started });
    } catch (e) {
        steps.push({ step: name, ok: false, error: String(e.message || e).split("\n")[0] });
        if (shots)
            await Promise.all(Object.entries(pages).map(([who, page]) => page.screenshot({ path: `${shots}/${name.replace(/\W+/g, "-")}-${who}.png` }).catch(() => undefined)));
    }
};
const expect = (condition, message) => {
    if (!condition) throw new Error(message);
};
const closeModal = async (page) => {
    const close = page.locator("[role=dialog] [aria-label=Close]").first();
    if (!(await close.isVisible().catch(() => false))) return;
    await close.click();
    await page
        .locator("[role=dialog]")
        .first()
        .waitFor({ state: "detached", timeout: 5000 })
        .catch(() => undefined);
};
const send = async (page, text) => {
    const box = page.locator("[role=textbox][contenteditable=true]").last();
    await box.click();
    await page.keyboard.type(text);
    await box.filter({ hasText: text }).waitFor({ timeout: 3000 });
    await page.keyboard.press("Enter");
};
const message = async (page, text) => {
    await page.locator("div[id^=message-content-]").getByText(text, { exact: true }).first().waitFor();
    const id = await page.evaluate(
        (t) =>
            [...document.querySelectorAll("div[id^=message-content-]")]
                .findLast((d) => d.innerText.trim() === t)
                ?.id.split("-")
                .pop(),
        text,
    );
    return page.locator(`[id^=chat-messages-][id$="-${id}"]`);
};
const toolbar = async (msg, name) => {
    for (let attempt = 0; ; attempt++) {
        await msg.hover({ position: { x: 300, y: 10 } });
        const button = msg.locator("[class*=buttonsInner]").getByRole("button", { name, exact: true });
        try {
            await button.click({ timeout: 3000 });
            return;
        } catch (e) {
            if (attempt === 2) throw e;
        }
    }
};
const openSection = async (page, label, ready) => {
    for (let attempt = 0; attempt < 5 && !(await ready.isVisible()); attempt++) {
        await page.getByText(label, { exact: true }).first().click();
        await sleep(1000);
    }
};
const store = (page, name, fn) => page.evaluate(([n, f]) => new Function("s", `return (${f})(s)`)(Vencord.Webpack.findStore(n)), [name, String(fn)]);
let guildId;
let generalId;
let voiceId;

for (const [name, user] of Object.entries(users))
    await step(`register ${name}`, async () => {
        const page = pages[name];
        await page.goto(`${origin}/register`);
        const inputs = page.locator("input");
        await inputs.nth(2).waitFor();
        await inputs.nth(0).fill(user.display);
        await inputs.nth(1).fill(user.username);
        await inputs.nth(2).fill(user.password);
        await page.getByRole("button", { name: "Create Account" }).click();
        await page.waitForURL(/\/channels\/@me/, { timeout: 30_000 });
        await page.locator("[role=dialog] [aria-label=Close]").first().waitFor({ timeout: 20_000 });
        await closeModal(page);
    });

await step("send friend request", async () => {
    await A.getByRole("tab", { name: "Add Friend" }).click();
    await A.getByPlaceholder(/username/i)
        .first()
        .fill(users.B.username);
    await A.getByRole("button", { name: "Send Friend Request" }).click();
    await A.getByText(/Success! Your friend request/).waitFor();
});

await step("accept friend request", async () => {
    await B.getByRole("tab", { name: /Pending/ }).click();
    await B.getByRole("button", { name: "Accept" }).click();
    await B.getByRole("tab", { name: "Online" }).waitFor();
});

await step("direct message both ways", async () => {
    await A.getByRole("tab", { name: "Online" }).click();
    await A.getByRole("button", { name: `Message ${users.B.display}` }).click();
    await A.waitForURL(/\/channels\/@me\/\d+/);
    await send(A, "dm from alice");
    await B.getByRole("link", { name: new RegExp(users.A.display) })
        .first()
        .click();
    await B.getByText("dm from alice", { exact: true }).waitFor();
    await send(B, "dm from bob");
    await A.getByText("dm from bob", { exact: true }).waitFor();
});

await step("create server", async () => {
    await A.getByRole("treeitem", { name: "Add a Server" }).click();
    await A.getByText("Create My Own").click();
    await A.getByText("For me and my friends").click();
    await A.getByRole("textbox").last().fill(`Everyday ${suffix}`);
    await A.getByRole("button", { name: "Create", exact: true }).click();
    await A.waitForURL(/\/channels\/\d+\/\d+/);
    [guildId, generalId] = A.url().split("/").slice(4, 6);
    await sleep(2000);
    await closeModal(A);
});

await step("invite friend through dm", async () => {
    await A.getByRole("button", { name: "Invite to Channel" }).first().click();
    await A.locator("[role=dialog]").getByText("Invite", { exact: true }).first().click();
    await A.locator("[role=dialog]").getByText("Sent", { exact: true }).first().waitFor();
    await closeModal(A);
    await B.getByRole("button", { name: "Join", exact: true }).last().click();
    await B.waitForURL(new RegExp(`/channels/${guildId}/`), { timeout: 20_000 });
});

await step("reply", async () => {
    await send(A, "first message from alice");
    await B.getByText("first message from alice", { exact: true }).waitFor();
    const first = await message(B, "first message from alice");
    await toolbar(first, "Reply");
    await send(B, "reply from bob");
    await A.getByText("reply from bob", { exact: true }).waitFor();
});

await step("reactions", async () => {
    const reply = await message(A, "reply from bob");
    await toolbar(reply, "Click to react with thumbsup");
    await toolbar(reply, "Add Reaction");
    await A.keyboard.type("fire");
    await sleep(800);
    await A.keyboard.press("Enter");
    await B.locator("[class*=reaction_]").first().waitFor();
    await B.locator("[class*=reaction_]").first().click();
    await sleep(1500);
    const counts = await (await message(A, "reply from bob")).locator("[class*=reaction_]").allInnerTexts();
    expect(counts.length === 2 && counts[0].includes("2"), `reaction counts ${JSON.stringify(counts)}`);
});

await step("upload", async () => {
    await B.locator("input[type=file]").first().setInputFiles([fixture, "assets/icon.png"]);
    await sleep(800);
    await send(B, "two files");
    await A.getByText(fixture.split("/").pop()).first().waitFor({ timeout: 15_000 });
    await A.locator("img[src*='icon.png']").last().waitFor();
});

await step("edit", async () => {
    await B.locator("[role=textbox][contenteditable=true]").last().click();
    await B.keyboard.press("ArrowUp");
    await sleep(500);
    await B.keyboard.press("ControlOrMeta+a");
    await B.keyboard.type("two files edited");
    await B.keyboard.press("Enter");
    await A.getByText("two files edited", { exact: true }).waitFor();
});

await step("delete", async () => {
    const first = await message(A, "first message from alice");
    await A.keyboard.down("Shift");
    await toolbar(first, "Delete");
    await A.keyboard.up("Shift");
    await B.getByText("Original message was deleted").waitFor();
});

await step("thread", async () => {
    const reply = await message(A, "reply from bob");
    await toolbar(reply, "More");
    await A.locator("#message-actions-thread").click();
    await A.getByPlaceholder("reply from bob").fill("everyday thread");
    await send(A, "thread starter");
    await A.waitForURL(/\/threads\/\d+/);
    await B.getByText("1 Message").click();
    await B.getByText("thread starter", { exact: true }).waitFor();
    await send(B, "bob in thread");
    await sleep(3000);
    const threadId = A.url().split("/").pop();
    const copies = await B.locator(`[id^=chat-messages-${threadId}-]`).filter({ hasText: "bob in thread" }).count();
    expect(copies === 1, `bob sees his thread message ${copies} times`);
    await A.locator(`[id^=chat-messages-${threadId}-]`).filter({ hasText: "bob in thread" }).waitFor();
    expect((await A.getByText("Message could not be loaded").count()) === 0, "thread starter reply could not be loaded");
});

await step("voice", async () => {
    voiceId = await A.evaluate((g) => Object.values(Vencord.Webpack.findStore("GuildChannelStore").getChannels(g).VOCAL ?? [])[0]?.channel.id, guildId);
    for (const page of [A, B]) {
        await page.locator(`[data-list-item-id=channels___${voiceId}]`).click();
        await sleep(3000);
    }
    await sleep(6000);
    for (const page of [A, B]) expect((await store(page, "RTCConnectionStore", (s) => s.getState())) === "RTC_CONNECTED", "voice not connected");
    for (const page of [A, B]) {
        const voiceUsers = await page.evaluate((id) => Object.keys(Vencord.Webpack.findStore("VoiceStateStore").getVoiceStatesForChannel(id)).length, voiceId);
        expect(voiceUsers === 2, `${voiceUsers} users in voice`);
    }
    for (const page of [A, B]) await page.getByRole("button", { name: "Disconnect" }).first().click();
    await sleep(1500);
});

await step("member list presence", async () => {
    for (const page of [A, B]) {
        await page.goto(`${origin}/channels/${guildId}/${generalId}`);
        await page.locator("[aria-label='Members']").first().waitFor({ timeout: 30_000 });
        await sleep(3000);
        const text = await page.locator("[aria-label='Members']").first().innerText();
        expect(/Online\s*[\u2014-]\s*2/.test(text), `member list shows ${JSON.stringify(text.slice(0, 80))}`);
    }
});

await step("user settings", async () => {
    await A.getByRole("button", { name: "User Settings" }).click();
    await A.getByText("Edit Profiles").click();
    await A.getByPlaceholder(users.A.username).fill(`${users.A.display} renamed`);
    await A.getByPlaceholder("Add your pronouns").fill("they/them");
    await A.getByRole("button", { name: "Save Changes" }).click();
    await A.getByRole("button", { name: "Save Changes" }).waitFor({ state: "hidden" });
    const light = A.locator("[aria-label=Light]").first();
    await openSection(A, "Appearance", light);
    await light.click();
    await sleep(1500);
    await A.keyboard.press("Escape");
    await B.getByText(`${users.A.display} renamed`).first().waitFor();
});

await step("server settings", async () => {
    await A.getByRole("button", { name: /server actions/ }).click();
    await A.getByText("Server Settings").first().click();
    await A.locator(`input[value='Everyday ${suffix}']`).fill(`Everyday ${suffix} renamed`);
    await A.getByRole("button", { name: "Save Changes" }).click();
    await A.getByRole("button", { name: "Save Changes" }).waitFor({ state: "hidden" });
    const createRole = A.getByRole("button", { name: "Create Role" });
    await openSection(A, "Roles", createRole);
    await createRole.click();
    await A.locator("input[value='new role']").fill("everyday role");
    await A.getByRole("button", { name: "Save Changes" }).click();
    await A.getByRole("button", { name: "Save Changes" }).waitFor({ state: "hidden" });
    await A.keyboard.press("Escape");
    await B.getByText(`Everyday ${suffix} renamed`).first().waitFor();
});

await step("channel topic", async () => {
    await A.locator(`[data-list-item-id=channels___${generalId}]`).hover();
    await A.getByRole("button", { name: "Edit Channel" }).first().click();
    await A.getByRole("textbox", { name: "Let everyone know how to use this channel!" }).click();
    await A.keyboard.type("everyday topic");
    await A.getByRole("button", { name: "Save Changes" }).click();
    await A.getByRole("button", { name: "Save Changes" }).waitFor({ state: "hidden" });
    await A.keyboard.press("Escape");
    await B.getByText("everyday topic").first().waitFor();
});

await step("logout and login", async () => {
    await A.getByRole("button", { name: "User Settings" }).click();
    await A.getByRole("tab", { name: "Log Out" })
        .or(A.locator("div").filter({ hasText: /^Log Out$/ }))
        .last()
        .click();
    await A.getByRole("button", { name: "Log Out" }).click();
    await A.waitForURL(/\/login/);
    await A.locator("input[name=email]").fill(users.A.username);
    await A.locator("input[name=password]").fill(users.A.password);
    await A.getByRole("button", { name: "Log In" }).click();
    await A.waitForURL(/\/channels\/@me/, { timeout: 30_000 });
    await A.getByText(`${users.A.display} renamed`).first().waitFor();
    const theme = await A.evaluate(() => document.documentElement.className);
    expect(theme.includes("theme-light"), `theme after login is ${theme}`);
});

await browser.close();
unlinkSync(fixture);
const serverErrors = serverLog
    ? readFileSync(serverLog, "utf8")
          .slice(logStart)
          .split("\n")
          .filter((line) => /error|Trace:|Unhandled|" 5\d\d /i.test(line))
          .slice(0, 50)
    : [];
const knownClient = [/<svg> attribute height: Expected length, "auto"/, /pageerror Starting password login/];
const unexpected = [...new Set(issues)].filter((x) => !knownClient.some((pattern) => pattern.test(x)));
console.log(
    JSON.stringify(
        {
            users: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.username])),
            steps,
            issues: unexpected,
            knownClientIssues: [...new Set(issues)].filter((x) => !unexpected.includes(x)),
            serverErrors,
            warnings: [...new Set(warnings)],
        },
        null,
        2,
    ),
);
process.exitCode = steps.every((x) => x.ok) && !unexpected.length && !serverErrors.length ? 0 : 1;
