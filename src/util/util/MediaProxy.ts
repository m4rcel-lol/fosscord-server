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

import crypto from "node:crypto";
import { Config } from "./Config";
import { Embed } from "@spacebar/schemas";

const signExternalPath = (path: string) => crypto.createHmac("sha1", Config.get().security.requestSignature).update(path).digest("base64url");

export const verifyExternalPath = (hash: string, path: string) => {
    const expected = signExternalPath(path);
    return hash.length === expected.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
};

export const externalProxyPath = (url: URL) => {
    const path = `${url.search ? `${encodeURIComponent(url.search)}/` : ""}${url.protocol.replace(":", "")}/${url.host}${url.pathname}`;
    return `/external/${signExternalPath(path)}/${path}`;
};

const cdnBase = () => (Config.get().cdn.endpointPublic || "").replace(/\/+$/, "");

export const externalProxyUrl = (url: URL) => `${cdnBase()}${externalProxyPath(url)}`;

const proxied = (url?: string, current?: string) => {
    if (!url || (current && current !== url)) return current;
    if (!URL.canParse(url)) return current;
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return current;
    if (cdnBase() && url.startsWith(cdnBase())) return current ?? url;
    return externalProxyUrl(parsed);
};

export function proxyEmbedMedia(embed: Embed): Embed {
    const out: Embed = { ...embed };
    for (const key of ["image", "thumbnail", "video"] as const) {
        const media = embed[key];
        if (media?.url) out[key] = { ...media, proxy_url: proxied(media.url, media.proxy_url) };
    }
    if (embed.author?.icon_url) out.author = { ...embed.author, proxy_icon_url: proxied(embed.author.icon_url, embed.author.proxy_icon_url) };
    if (embed.footer?.icon_url) out.footer = { ...embed.footer, proxy_icon_url: proxied(embed.footer.icon_url, embed.footer.proxy_icon_url) };
    return out;
}
