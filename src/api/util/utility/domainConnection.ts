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
import dns from "node:dns/promises";
import net from "node:net";
import { JwtKeypairManager } from "@spacebar/util";

const isPrivateAddress = (address: string) => {
    if (net.isIPv4(address)) {
        const [a, b] = address.split(".").map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    const lower = address.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:");
};

export const DomainConnection = {
    normalize(domain: string) {
        const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
        if (normalized.length > 253 || net.isIP(normalized) || !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(normalized)) return undefined;
        return normalized;
    },

    proof(user_id: string, domain: string) {
        const secret = JwtKeypairManager.keypair.privateKey.export({ format: "pem", type: "sec1" });
        return `dh=${crypto.createHmac("sha256", secret).update(`domain-connection:${user_id}:${domain}`).digest("hex").slice(0, 40)}`;
    },

    async verify(domain: string, proof: string) {
        const records = await dns.resolveTxt(`_discord.${domain}`).catch(() => [] as string[][]);
        if (records.some((parts) => parts.join("").trim() === proof)) return true;

        const addresses = await dns.lookup(domain, { all: true }).catch(() => []);
        if (!addresses.length || addresses.some((x) => isPrivateAddress(x.address))) return false;
        const res = await fetch(`https://${domain}/.well-known/discord`, { redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
        if (!res?.ok) return false;
        return (await res.text().catch(() => "")).slice(0, 1024).trim() === proof;
    },
};
