/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import express, { Application } from "express";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { Config } from "@spacebar/util";

const ASSET_FOLDER_PATH = path.join(__dirname, "..", "..", "assets");
const CACHE_PATH = path.join(ASSET_FOLDER_PATH, "cache");
const PATCH_PATH = path.join(ASSET_FOLDER_PATH, "client_patches");
const VENCORD_PATH = path.join(ASSET_FOLDER_PATH, "vencord");
const VENCORD_SCRIPT = path.join(VENCORD_PATH, "vencord.js");
const UPSTREAM = "https://discord.com";

const ENDPOINT_KEYS = [
    "API_ENDPOINT",
    "API_PROTOCOL",
    "GATEWAY_ENDPOINT",
    "GATEWAY_ALT_ENDPOINT",
    "ASSET_ENDPOINT",
    "MEDIA_PROXY_ENDPOINT",
    "IMAGE_PROXY_ENDPOINTS",
    "CDN_HOST",
    "DEVELOPERS_ENDPOINT",
    "MARKETING_ENDPOINT",
    "WEBAPP_ENDPOINT",
    "WIDGET_ENDPOINT",
    "INVITE_HOST",
    "GUILD_TEMPLATE_HOST",
    "GIFT_CODE_HOST",
    "PRIMARY_DOMAIN",
    "REMOTE_AUTH_ENDPOINT",
    "RTC_LATENCY_ENDPOINT",
    "MIGRATION_SOURCE_ORIGIN",
    "MIGRATION_DESTINATION_ORIGIN",
];

const stripScheme = (url: string) => url.replace(/^(https?|wss?):\/\//, "").replace(/\/$/, "");

const buildHtml = () => {
    const source = fs.readFileSync(path.join(CACHE_PATH, "index.html"), "utf8");
    const { client, cdn, gateway } = Config.get();

    const envMatch = source.match(/<script[^>]*>\s*window\.GLOBAL_ENV\s*=([\s\S]*?)<\/script>/);
    if (!envMatch) throw new Error("[TestClient] assets/cache/index.html has no GLOBAL_ENV, rerun `npm run generate:client`");
    const sandbox: { window: { GLOBAL_ENV?: Record<string, unknown> } } = { window: {} };
    vm.runInNewContext(`window.GLOBAL_ENV =${envMatch[1]}`, sandbox);
    const base = sandbox.window.GLOBAL_ENV ?? {};
    for (const key of ENDPOINT_KEYS) delete base[key];

    const cdnHost = stripScheme(cdn.endpointPublic || "");
    const gatewayUrl = (gateway.endpointPublic || "").replace(/\/$/, "");

    const env = `<script>
(() => {
    const host = location.host;
    const secure = location.protocol === "https:";
    const cdn = ${JSON.stringify(cdnHost)} || host;
    const gateway = ${JSON.stringify(gatewayUrl)} || \`\${secure ? "wss" : "ws"}://\${host}\`;
    window.GLOBAL_ENV = Object.assign(${JSON.stringify(base)}, {
        HTML_TIMESTAMP: Date.now(),
        API_ENDPOINT: \`//\${host}/api\`,
        API_PROTOCOL: location.protocol,
        GATEWAY_ENDPOINT: gateway,
        GATEWAY_ALT_ENDPOINT: gateway,
        ASSET_ENDPOINT: \`//\${host}\`,
        MEDIA_PROXY_ENDPOINT: \`//\${cdn}\`,
        IMAGE_PROXY_ENDPOINTS: \`//\${host}\`,
        CDN_HOST: cdn,
        DEVELOPERS_ENDPOINT: \`//\${host}\`,
        MARKETING_ENDPOINT: \`//\${host}\`,
        WEBAPP_ENDPOINT: \`//\${host}\`,
        WIDGET_ENDPOINT: \`//\${host}/widget\`,
        INVITE_HOST: \`\${host}/invite\`,
        GUILD_TEMPLATE_HOST: \`\${host}/template\`,
        GIFT_CODE_HOST: \`\${host}/gift\`,
        PRIMARY_DOMAIN: host,
        REMOTE_AUTH_ENDPOINT: \`\${secure ? "wss" : "ws"}://\${host}/remote-auth\`,
        RTC_LATENCY_ENDPOINT: \`//\${host}/rtc\`,
        MIGRATION_SOURCE_ORIGIN: location.origin,
        MIGRATION_DESTINATION_ORIGIN: location.origin,
    });
})();
</script>`;

    const patches = fs.existsSync(PATCH_PATH)
        ? fs
              .readdirSync(PATCH_PATH)
              .filter((x) => x.endsWith(".js"))
              .sort()
              .map((x) => `<script>${fs.readFileSync(path.join(PATCH_PATH, x), "utf8")}</script>`)
              .join("\n")
        : "";

    const vencord = fs.existsSync(VENCORD_SCRIPT)
        ? `<script src="/assets/vencord/vencord.js?v=${crypto.createHash("sha256").update(fs.readFileSync(VENCORD_SCRIPT)).digest("hex").slice(0, 12)}"></script>`
        : "";
    if (!vencord) console.warn("[TestClient] assets/vencord/vencord.js is missing, run `node scripts/vencord.js` to build the client mods");

    return source
        .replace(envMatch[0], `${env}\n${vencord}\n${patches}`)
        .replace(/<script[^>]*>[^<]*__CF\$cv\$params[\s\S]*?<\/script>/, "")
        .replace(/ nonce="[^"]*"/g, "")
        .replace(/<link rel="preconnect"[^>]*>\s*/g, "")
        .replace(/<!-- section:seometa -->[\s\S]*?<!-- endsection -->/, "")
        .replace(/<title>[^<]*<\/title>/, `<title>${client.instanceName}</title>`);
};

export default function TestClient(app: Application) {
    app.use("/assets", express.static(path.join(ASSET_FOLDER_PATH, "public")));
    app.use("/assets/vencord", express.static(VENCORD_PATH, { setHeaders: (res) => res.set("Cache-Control", "no-cache") }));
    app.use("/vendor/monaco", express.static(path.join(VENCORD_PATH, "vendor", "monaco"), { setHeaders: (res) => res.set("Cache-Control", "no-cache") }));
    app.use(
        "/assets",
        express.static(CACHE_PATH, process.env.NODE_ENV === "development" ? { setHeaders: (res) => res.set("Cache-Control", "no-cache") } : { immutable: true, maxAge: "30d" }),
    );

    if (!Config.get().client.useTestClient || !fs.existsSync(path.join(CACHE_PATH, "index.html"))) return;

    let html = buildHtml();
    const missLog = path.join(ASSET_FOLDER_PATH, "cacheMisses");

    app.get("/assets/version.:channel.json", (req, res) => {
        const hash = fs.readFileSync(path.join(CACHE_PATH, "index.html"), "utf8").match(/"VERSION_HASH":"(\w+)"/)?.[1];
        res.set("Cache-Control", "no-cache").json({ hash, required: false });
    });

    app.get("/assets/:file", async (req, res) => {
        const file = req.params.file;
        if (!/^[\w.-]+$/.test(file) || file.endsWith(".map")) return res.sendStatus(404);
        const upstream = await fetch(`${UPSTREAM}/assets/${file}`).catch(() => null);
        if (!upstream?.ok) return res.sendStatus(upstream?.status ?? 502);
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.type(contentType);
        fs.promises.appendFile(missLog, `${file}\n`).catch(() => {});
        res.send(Buffer.from(await upstream.arrayBuffer()));
    });

    if (process.env.NODE_ENV === "development") {
        const sourceStamp = () =>
            [path.join(CACHE_PATH, "index.html"), PATCH_PATH, VENCORD_SCRIPT, ...(fs.existsSync(PATCH_PATH) ? fs.readdirSync(PATCH_PATH).map((x) => path.join(PATCH_PATH, x)) : [])]
                .map((x) => fs.statSync(x, { throwIfNoEntry: false })?.mtimeMs ?? 0)
                .join();
        let stamp = sourceStamp();
        app.use((req, res, next) => {
            const current = sourceStamp();
            if (current !== stamp) {
                stamp = current;
                html = buildHtml();
            }
            next();
        });
    }

    app.get("/{*splat}", (req, res, next) => {
        if (/^\/(api|cdn|attachments|avatars|icons|banners|emojis|stickers|imageproxy)\b/.test(req.path)) return next();
        res.set("Cache-Control", "no-cache");
        res.type("html").send(html);
    });
}
