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

import express, { Application, Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Config } from "@spacebar/util";

const ASSET_FOLDER_PATH = path.join(__dirname, "..", "..", "assets");
const CACHE_PATH = path.join(ASSET_FOLDER_PATH, "cache");
const COMPRESSED_PATH = process.env.CLIENT_COMPRESSED_PATH ? path.resolve(process.env.CLIENT_COMPRESSED_PATH) : path.join(ASSET_FOLDER_PATH, "cache_compressed");
const PATCH_PATH = path.join(ASSET_FOLDER_PATH, "client_patches");
const VENCORD_PATH = path.join(ASSET_FOLDER_PATH, "vencord");
const VENCORD_SCRIPT = path.join(VENCORD_PATH, "vencord.js");
const UPSTREAM = "https://discord.com";
const DEVELOPMENT = process.env.NODE_ENV === "development";
const HASHED = /(?:^|[.-])[0-9a-f]{8,32}\.\w+$/;
const COMPRESSIBLE = /\.(js|css|json|svg|wasm)$/;
const PRECOMPRESSED: Record<string, string> = { br: "br", gzip: "gz" };

const acceptedEncodings = (header = "") => {
    const weights = new Map<string, number>();
    for (const part of header.toLowerCase().split(",")) {
        const [name, ...params] = part.split(";").map((x) => x.trim());
        const q = params.find((x) => x.startsWith("q="));
        if (name) weights.set(name, q ? Number(q.slice(2)) : 1);
    }
    const weight = (encoding: string) => weights.get(encoding) ?? weights.get("*") ?? 0;
    return ["br", "zstd", "gzip"].filter((x) => weight(x) > 0).sort((a, b) => weight(b) - weight(a));
};

const compressor = (encoding: string) => {
    if (encoding === "zstd") return zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 } });
    if (encoding === "br") return zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    return zlib.createGzip({ level: 6 });
};

const stat = (file: string) => fs.promises.stat(file).catch(() => null);

const serveAsset = async (req: Request, res: Response, next: NextFunction, root: string, precompressed: boolean) => {
    const file = req.params.file as string;
    if (!/^\w[\w.-]*$/.test(file)) return next();
    const source = path.join(root, file);
    const sourceStat = await stat(source);
    if (!sourceStat?.isFile()) return next();

    res.set("Cache-Control", DEVELOPMENT || !precompressed || !HASHED.test(file) ? "no-cache" : "public, max-age=31536000, immutable");
    res.set("Access-Control-Allow-Origin", "*");
    if (!COMPRESSIBLE.test(file)) return res.sendFile(source, { cacheControl: false, dotfiles: "allow" });

    res.vary("Accept-Encoding");
    res.type(path.extname(file));
    const encodings = acceptedEncodings(req.headers["accept-encoding"]);
    for (const encoding of precompressed ? encodings : []) {
        if (!PRECOMPRESSED[encoding]) continue;
        const compressed = path.join(COMPRESSED_PATH, `${file}.${PRECOMPRESSED[encoding]}`);
        const compressedStat = await stat(compressed);
        if (!compressedStat || compressedStat.mtimeMs < Math.floor(sourceStat.mtimeMs)) continue;
        res.set("Content-Encoding", encoding);
        return res.sendFile(compressed, { cacheControl: false, acceptRanges: false, dotfiles: "allow" });
    }

    if (!encodings.length || sourceStat.size < 1024) return res.sendFile(source, { cacheControl: false, dotfiles: "allow" });
    res.set("Content-Encoding", encodings[0]);
    res.set("ETag", `W/"${sourceStat.size.toString(16)}-${Math.floor(sourceStat.mtimeMs).toString(16)}-${encodings[0]}"`);
    res.set("Last-Modified", sourceStat.mtime.toUTCString());
    if (req.fresh) return res.status(304).end();
    if (req.method === "HEAD") return res.end();
    await pipeline(fs.createReadStream(source), compressor(encodings[0]), res).catch(() => res.destroy());
};

const LOGO_PATH =
    "M3.21 4.84C3.44 3.71 4.58 3.24 5.51 3.78L12 7.59L18.49 3.78C19.42 3.24 20.56 3.71 20.79 4.84L22.8 14.61C23.5 17.82 21.06 20.56 17.78 20.56L6.22 20.56C2.94 20.56 .5 17.82 1.2 14.61ZM7.35 11.06a1.27 1.27 0 0 0-1.27 1.27v2.64a1.27 1.27 0 0 0 1.27 1.27h2.67a1.27 1.27 0 0 0 1.27-1.27v-2.64a1.27 1.27 0 0 0-1.27-1.27ZM13.97 11.06a1.27 1.27 0 0 0-1.27 1.27v2.64a1.27 1.27 0 0 0 1.27 1.27h2.67a1.27 1.27 0 0 0 1.27-1.27v-2.64a1.27 1.27 0 0 0-1.27-1.27Z";

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

const wordmark = (box?: [number, number]) => {
    const name = Config.get().client.instanceName || "Fosscord";
    const width = Math.ceil(34 + [...name].length * 12.5);
    const [boxWidth, boxHeight] = box ?? [width, 24];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}" viewBox="0 0 ${width} 24" fill="none"><path fill="#fff" d="${LOGO_PATH}"/><text x="32" y="19.5" fill="#fff" font-family="'gg sans','Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif" font-size="20" font-weight="800">${escapeXml(name)}</text></svg>`;
};

const BRANDED_ASSETS: Record<string, () => string> = {
    "131c318dd45b7aa4.svg": () => wordmark(),
    "bbbc3d376d38e7bc.svg": () => wordmark([112, 36]),
    "dd05fd1ea37e7747.png": () =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/><path fill="#fff" transform="translate(23 23) scale(2.25)" d="${LOGO_PATH}"/></svg>`,
};

export function TestClientAssets(app: Application) {
    const noCache = { setHeaders: (res: Response) => res.set("Cache-Control", "no-cache") };
    app.get("/assets/favicon.ico", (req, res) => {
        const { image } = Config.get().general;
        res.set("Cache-Control", "no-cache");
        if (image && /^https?:\/\//.test(image)) return res.redirect(302, image);
        return res.type("png").sendFile(path.join(ASSET_FOLDER_PATH, "icon.png"), { cacheControl: false, dotfiles: "allow" });
    });
    app.get("/assets/:file", (req, res, next) => {
        const branded = BRANDED_ASSETS[req.params.file as string];
        if (!branded) return next();
        res.set("Cache-Control", "no-cache").type("image/svg+xml").send(branded());
    });
    app.use("/assets", express.static(path.join(ASSET_FOLDER_PATH, "public")));
    app.get("/assets/vencord/:file", (req, res, next) => void serveAsset(req, res, next, VENCORD_PATH, false).catch(next));
    app.use("/assets/vencord", express.static(VENCORD_PATH, noCache));
    app.use("/vendor/monaco", express.static(path.join(VENCORD_PATH, "vendor", "monaco"), noCache));
    app.get("/assets/:file", (req, res, next) => void serveAsset(req, res, next, CACHE_PATH, true).catch(next));
}

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
        INSTANCE_NAME: ${JSON.stringify(client.instanceName).replace(/</g, "\\u003c")},
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
        ? `<script src="/assets/vencord/vencord.js?v=${createHash("sha256").update(fs.readFileSync(VENCORD_SCRIPT)).digest("hex").slice(0, 12)}"></script>`
        : "";
    if (!vencord) console.warn("[TestClient] assets/vencord/vencord.js is missing, run `npm run build:vencord` to build the client mods");

    return source
        .replace(envMatch[0], `${env}\n${vencord}\n${patches}`)
        .replace(/<script[^>]*>[^<]*__CF\$cv\$params[\s\S]*?<\/script>/, "")
        .replace(/<script[^>]*src="\/assets\/sentry\.[0-9a-f]+\.js"[^>]*><\/script>\s*/g, "")
        .replace(/ nonce="[^"]*"/g, "")
        .replace(/<link rel="preconnect"[^>]*>\s*/g, "")
        .replace(/<!-- section:seometa -->[\s\S]*?<!-- endsection -->/, "")
        .replace(/<title>[^<]*<\/title>/, `<title>${client.instanceName}</title>`);
};

const renderPage = () => {
    const body = Buffer.from(buildHtml());
    return {
        body,
        etag: `"${createHash("sha1").update(body).digest("base64url")}"`,
        br: zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } }),
        gzip: zlib.gzipSync(body, { level: 9 }),
    };
};

export default function TestClient(app: Application) {
    if (!Config.get().client.useTestClient || !fs.existsSync(path.join(CACHE_PATH, "index.html"))) return;

    let page = renderPage();
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

    const sourceStamp = () =>
        [path.join(CACHE_PATH, "index.html"), PATCH_PATH, VENCORD_SCRIPT, ...(fs.existsSync(PATCH_PATH) ? fs.readdirSync(PATCH_PATH).map((x) => path.join(PATCH_PATH, x)) : [])]
            .map((x) => fs.statSync(x, { throwIfNoEntry: false })?.mtimeMs ?? 0)
            .join();
    let stamp = DEVELOPMENT ? sourceStamp() : "";

    app.get("/{*splat}", (req, res, next) => {
        if (/^\/(api|cdn|attachments|avatars|icons|banners|emojis|stickers|imageproxy)\b/.test(req.path)) return next();
        if (DEVELOPMENT && stamp !== (stamp = sourceStamp())) page = renderPage();
        res.set({ "Cache-Control": "no-cache", ETag: page.etag });
        res.vary("Accept-Encoding");
        res.type("html");
        if (req.fresh) return res.status(304).end();
        const encoding = acceptedEncodings(req.headers["accept-encoding"]).find((x) => x === "br" || x === "gzip") as "br" | "gzip" | undefined;
        if (encoding) res.set("Content-Encoding", encoding);
        res.send(encoding ? page[encoding] : page.body);
    });
}
