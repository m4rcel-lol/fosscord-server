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

import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

const NOT_AN_ARGUMENT = String.raw`(?<!\[\d+,"[\w$]*)`;

const instanceName = () => String((window as any).GLOBAL_ENV?.INSTANCE_NAME || "Fosscord").replace(/['"\\<>]/g, "");

export default definePlugin({
    name: "FosscordBranding",
    description: "Uses this instance's name instead of Discord, and Premium instead of Nitro, in every translated string.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: /JSON\.parse\('\{"[\w+/]{6}":\["/,
            all: true,
            noWarn: true,
            replacement: [
                {
                    match: new RegExp(`${NOT_AN_ARGUMENT}Nitro`, "g"),
                    replace: "Premium",
                },
                {
                    match: new RegExp(`${NOT_AN_ARGUMENT}Discord`, "g"),
                    replace: () => instanceName(),
                },
            ],
        },
    ],
});
