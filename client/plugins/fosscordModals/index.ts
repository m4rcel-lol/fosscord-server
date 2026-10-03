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

export default definePlugin({
    name: "FosscordModals",
    description: "Keeps the dimmed backdrop under its modals when a modal such as User Settings is closed and reopened quickly, so it never blocks clicks.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: /"replaceAll"===\i\.stackingBehavior/,
            replacement: {
                match: /(\(0,\i\.jsx\)\("div",\{className:\i\(\)\(\i\.\i,!\i&&\i\.\i\)),(?=children:\i\}\))/,
                replace: "$1,style:{zIndex:1},",
            },
        },
    ],
});
