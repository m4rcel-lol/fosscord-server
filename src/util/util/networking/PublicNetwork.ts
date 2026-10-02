/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Config } from "../Config";

const privateRanges = new BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3],
] as const)
    privateRanges.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
    ["::", 127],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
] as const)
    privateRanges.addSubnet(network, prefix, "ipv6");

export function isPrivateAddress(address: string) {
    const family = isIP(address);
    if (!family) return true;
    return privateRanges.check(address, family === 6 ? "ipv6" : "ipv4");
}

export async function isPublicUrl(url: string | URL, opts: { httpsOnly?: boolean } = {}) {
    if (!URL.canParse(url)) return false;
    const parsed = new URL(url);
    if (Config.get().security.allowPrivateNetworkRequests) return /^https?:$/.test(parsed.protocol);
    if (parsed.protocol !== "https:" && (opts.httpsOnly || parsed.protocol !== "http:")) return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
        ? [host]
        : await lookup(host, { all: true, verbatim: true }).then(
              (results) => results.map(({ address }) => address),
              () => [],
          );
    return addresses.length > 0 && !addresses.some(isPrivateAddress);
}

export async function fetchPublicUrl(url: string, init: RequestInit = {}, redirects = 3): Promise<Response> {
    if (!(await isPublicUrl(url))) throw new Error(`refusing to fetch non-public url ${url}`);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (redirects <= 0) throw new Error(`too many redirects fetching ${url}`);
    return fetchPublicUrl(new URL(location, url).toString(), init, redirects - 1);
}
