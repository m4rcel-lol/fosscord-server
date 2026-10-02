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

const TTL = 10 * 60 * 1000;
const codes = new Map<string, { code: string; expires: number }>();
const tokens = new Map<string, { token: string; expires: number }>();

export const EmailChange = {
    createCode(user_id: string) {
        const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
        codes.set(user_id, { code, expires: Date.now() + TTL });
        return code;
    },

    verifyCode(user_id: string, code: string, required: boolean) {
        const entry = codes.get(user_id);
        if (required && (!entry || entry.expires < Date.now() || entry.code !== code.trim())) return undefined;
        codes.delete(user_id);
        const token = crypto.randomBytes(24).toString("base64url");
        tokens.set(user_id, { token, expires: Date.now() + TTL });
        return token;
    },

    consumeToken(user_id: string, token: string) {
        const entry = tokens.get(user_id);
        if (!entry || entry.expires < Date.now() || entry.token !== token) return false;
        tokens.delete(user_id);
        return true;
    },
};
