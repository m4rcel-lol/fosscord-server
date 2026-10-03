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

import { FosscordAuthor, hideNotices, hideSetting, redirectHome } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordNoAppUpsells",
    description: "Removes every prompt to download the desktop or mobile apps, and the game library that only the desktop app fills.",
    authors: [FosscordAuthor],
    required: true,

    redirectHome,

    patches: [
        hideNotices(["DOWNLOAD_NAG"]),
        {
            find: '"app-download-button"',
            replacement: {
                match: /return(?=.{0,50}id:"app-download-button")/,
                replace: "return null;return",
            },
        },
        {
            find: 'key:"download",iconUrl:',
            replacement: {
                match: /\(0,\i\.isWeb\)\(\)(?=&&\i\.push\(\{key:"download")/,
                replace: "!1",
            },
        },
        {
            find: ".SYSTEM_CUSTOM_KEYBINDS_CATEGORY,{",
            replacement: hideSetting("SYSTEM_CUSTOM_KEYBINDS_CATEGORY"),
        },
        {
            find: "QUEST_HOME_DEPRECATED,render:",
            replacement: {
                match: /(path:\i\.\i\.APPLICATION_LIBRARY,render:)\i/,
                replace: "$1$self.redirectHome",
            },
        },
    ],
});
