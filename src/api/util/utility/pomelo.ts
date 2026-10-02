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

export const Pomelo = {
    validate(username: string) {
        if (username.length < 2 || username.length > 32) throw FieldErrors({ username: { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 2 and 32 in length." } });
        if (!/^[a-z0-9_.]+$/.test(username) || username.includes(".."))
            throw FieldErrors({
                username: {
                    code: "USERNAME_INVALID_CHARACTERS",
                    message: "Username can only contain lowercase letters, numbers, underscores and periods, without consecutive periods.",
                },
            });
    },

    taken(username: string, except?: string) {
        return User.isUsernameTaken(username, except);
    },

    suggest(base?: string) {
        return User.suggestUsername(base ?? "");
    },
};
