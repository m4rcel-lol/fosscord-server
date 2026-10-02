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

import { User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { ILike, Not } from "typeorm";

export const Pomelo = {
    validate(username: string) {
        if (username.length < 2 || username.length > 32)
            throw FieldErrors({ username: { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 2 and 32 in length." } });
        if (!/^[a-z0-9_.]+$/.test(username) || username.includes(".."))
            throw FieldErrors({
                username: {
                    code: "USERNAME_INVALID_CHARACTERS",
                    message: "Username can only contain lowercase letters, numbers, underscores and periods, without consecutive periods.",
                },
            });
    },

    async taken(username: string, except?: string) {
        return !!(await User.findOne({
            where: { username: ILike(username.replace(/[\\%_]/g, (x) => `\\${x}`)), discriminator: "0", ...(except ? { id: Not(except) } : {}) },
            select: { id: true },
        }));
    },

    async suggest(base?: string) {
        const root =
            (base ?? "")
                .toLowerCase()
                .replace(/[^a-z0-9_.]/g, "")
                .replace(/\.{2,}/g, ".")
                .slice(0, 26) || "user";
        const candidate = root.length >= 2 ? root : `${root}_`;
        if (!(await Pomelo.taken(candidate))) return candidate;
        for (let i = 0; i < 20; i++) {
            const next = `${candidate}${Math.floor(Math.random() * 10_000)}`;
            if (!(await Pomelo.taken(next))) return next;
        }
        return `${candidate}${Date.now() % 1_000_000}`;
    },
};
