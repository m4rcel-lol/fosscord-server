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

const TAG = 8;
const SELECT = 5;
const PLURAL = 6;

const CANDIDATE = /discord|discrod|nitr|ディスコード|ไนโตร/i;

const FINNISH_CASES = new Set(["n", "a", "ssa", "sta", "lla", "lta", "lle", "ksi", "na", "si", "ni", "mme", "nne", "kin"]);

const TURKISH_CASES: Record<string, string> = { ya: "a", yu: "u", yla: "la", yle: "le", da: "da", dan: "dan", daki: "daki", nun: "un", nu: "unu", n: "un", ye: "e" };

const premium = (vowel: string, suffix: string, turkish: boolean) => {
    if (/^[oó]*$/.test(suffix) || suffix === "ween" || suffix === "to") return "Premium";
    if (turkish && suffix === "n") return "Premium'un";
    if (vowel === "ó") {
        const rest = suffix.replace(/^ó+/, "");
        if (rest === "val") return "Premiummal";
        if (rest === "t" || rest === "n") return `Premiumo${rest}`;
        if (rest.startsWith("d")) return `Premiumo${rest}`;
        return `Premium${rest}`;
    }
    if (suffix === "on") return "Premiumiin";
    if (FINNISH_CASES.has(suffix)) return `Premiumi${suffix}`;
    if (suffix === "m" || suffix === "v") return `Premiumo${suffix}`;
    return `Premium${suffix}`;
};

const brandText = (text: string, name: string) => {
    if (!CANDIDATE.test(text)) return text;
    const host = location.host;
    return text
        .replace(/https?:\/\/discord\.gg\//g, () => `${location.origin}/invite/`)
        .replace(/(?<![\w@.-])discord\.gg\//g, () => `${host}/invite/`)
        .replace(/https?:\/\/(?:www\.)?discord\.com(?![\w.-])/g, () => location.origin)
        .replace(/(?<![\w@./-])discord\.com(?![\w.-])/g, () => host)
        .replace(/DISCORD/g, (match) => (/741741/.test(text) ? match : name.toUpperCase()))
        .replace(/Discord|Discrod|ディスコード/g, () => name)
        .replace(/(?<![\p{L}\w.@/-])discord(?![\p{L}\w.@/-])/gu, () => name)
        .replace(/NITRO/g, "PREMIUM")
        .replace(/ไนโตร/g, "Premium")
        .replace(/Nitro(['’])(\p{Script=Latin}+)/gu, (match, apostrophe, suffix) =>
            TURKISH_CASES[suffix] ? `Premium${apostrophe}${TURKISH_CASES[suffix]}` : `Premium${apostrophe}${suffix}`,
        )
        .replace(/Nitr([oóо])(\p{Script=Latin}*)/gu, (match, vowel, suffix) => premium(vowel, suffix, /[ığşüçİ]/.test(text)))
        .replace(/Nitr(?:a|u+|em|om|e|y|ou)(?!\p{Script=Latin})/gu, "Premium");
};

const QR_LOGIN = /^\["Scan this with the ",\[8,"\$b",\["[^"]*"\]\]," to log in instantly\."\]$/;

const QR_LABEL = JSON.stringify(["QR code to log in with the Discord mobile app"]);

const brandList = (list: unknown[], name: string): unknown[] =>
    list.map((node) => (typeof node === "string" ? brandText(node, name) : Array.isArray(node) ? brandNode(node, name) : node));

const brandOptions = (options: Record<string, unknown>, name: string) =>
    Object.fromEntries(Object.entries(options).map(([key, value]) => [key, Array.isArray(value) ? brandList(value, name) : value]));

const brandNode = (node: unknown[], name: string): unknown[] => {
    const [type] = node;
    if (type === TAG && Array.isArray(node[2])) return [...node.slice(0, 2), brandList(node[2], name), ...node.slice(3)];
    if ((type === SELECT || type === PLURAL) && node[2] && typeof node[2] === "object")
        return [...node.slice(0, 2), brandOptions(node[2] as Record<string, unknown>, name), ...node.slice(3)];
    return node;
};

export const brandMessages = (messages: Record<string, unknown>) => {
    if (!messages || typeof messages !== "object" || Array.isArray(messages)) return messages;
    const name = String((window as any).GLOBAL_ENV?.INSTANCE_NAME || "Fosscord");
    const qrLabel = JSON.stringify(messages["SzYj9v"]);
    for (const key in messages) {
        const value = messages[key];
        if (typeof value === "string") messages[key] = brandText(value, name);
        else if (Array.isArray(value)) messages[key] = brandList(value, name);
    }
    const qr = messages["Qq+A6i"];
    if (Array.isArray(qr) && QR_LOGIN.test(JSON.stringify(qr)))
        messages["Qq+A6i"] = ["Scan this with ", [8, "$b", ["your phone's camera"]], ", then approve the login on your phone."];
    if (qrLabel === QR_LABEL) messages["SzYj9v"] = ["QR code to log in with your phone's camera"];
    return messages;
};
