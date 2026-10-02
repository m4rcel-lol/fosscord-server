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
import { FieldErrors } from "@spacebar/util";
import { readTicket, signTicket } from "./mfa";

const TTL = 10 * 60 * 1000;
const codes = new Map<string, { code: string; user_id?: string; expires: number; attempts: number }>();

export const PhoneVerification = {
    normalize(phone: unknown) {
        const normalized = typeof phone === "string" ? phone.replace(/[\s().-]/g, "") : "";
        if (!/^\+[1-9]\d{6,14}$/.test(normalized)) throw FieldErrors({ phone: { code: "PHONE_NUMBER_INVALID", message: "Invalid phone number" } });
        return normalized;
    },

    send(phone: string, user_id?: string) {
        const now = Date.now();
        for (const [key, entry] of codes) if (entry.expires < now) codes.delete(key);
        const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
        codes.set(phone, { code, user_id, expires: now + TTL, attempts: 0 });
        console.log(`[SMS] no sms provider configured, verification code for ${phone}${user_id ? ` (user ${user_id})` : ""} is ${code}`);
    },

    verify(phone: string, code: unknown, user_id?: string) {
        const entry = codes.get(phone);
        if (!entry || entry.expires < Date.now() || (entry.user_id && user_id && entry.user_id !== user_id)) return undefined;
        if (typeof code !== "string" || entry.code !== code.replace(/\s/g, "")) {
            if (++entry.attempts >= 5) codes.delete(phone);
            return undefined;
        }
        codes.delete(phone);
        return signTicket({ typ: "phone", uid: entry.user_id ?? user_id, phone }, TTL / 1000);
    },

    readToken(token: unknown, user_id: string) {
        const decoded = readTicket<{ typ: string; uid?: string; phone?: string }>(token, "phone");
        if (!decoded?.phone || (decoded.uid && decoded.uid !== user_id)) return undefined;
        return decoded.phone;
    },
};
