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

import { FosscordAuthor } from "./shared";

export default definePlugin({
    name: "Fosscord",
    description: "Points the client at this instance instead of Discord's CDN and status page.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: "fetchChangelogConfig(){",
            replacement: {
                match: /https:\/\/cdn\.discordapp\.com\/changelogs\//g,
                replace: "${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/changelogs/",
            },
        },
        {
            find: "=location.pathname+location.search;return(0,",
            all: true,
            replacement: {
                match: /let (\i)=location\.pathname\+location\.search;/,
                replace: 'let $1=/^\\/(login|register)(\\/|$)/.test(location.pathname)?new URLSearchParams(location.search).get("redirect_to"):location.pathname+location.search;',
            },
        },
        {
            find: "/api/v2/incidents/unresolved.json",
            replacement: {
                match: /`\$\{\i\.\i\}\/api\/v2\//g,
                replace: "`${location.origin}/api/v9/",
            },
        },
    ],
});
