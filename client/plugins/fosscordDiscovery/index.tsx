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

import { getIntlMessageFromHash } from "@utils/discord";
import definePlugin from "@utils/types";
import { Text } from "@webpack/common";

import { FosscordAuthor, redirectTo } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordDiscovery",
    description: "Shows an empty state in Discover when this instance has no servers to list yet, and sends /activities to the app directory.",
    authors: [FosscordAuthor],
    required: true,

    redirectTo,

    renderEmpty: () => (
        <Text variant="text-md/normal" color="text-muted" style={{ padding: "32px 0", textAlign: "center" }}>
            {getIntlMessageFromHash("MwjTvn")}
        </Text>
    ),

    patches: [
        {
            find: ".ImpressionNames.ACTIVITY_DETAILS,impressionProperties",
            replacement: {
                match: /(\(0,(\i)\.jsx\)\((\i\.\i),\{path:(\i\.\i)\.ACTIVITY,disableTrack:!0,children:\(0,\i\.jsx\)\(\i\.\i,\{to:\i\.\i\.ME\}\)\}\),)/,
                replace: '$1(0,$2.jsx)($3,{path:$4.ACTIVITIES,exact:!0,disableTrack:!0,children:$self.redirectTo("/discovery/applications")}),',
            },
        },
        {
            find: "DISCOVER_POPULAR}",
            replacement: {
                match: /(variant:"heading-lg\/semibold",color:"text-strong",children:\i\}\),\(0,(\i)\.jsx\)\(\i\.\i,\{children:)(\(0,\2\.jsx\)\("div",\{className:\i\.\i,children:(\i)\}\))/,
                replace: "$1$4.length===0?$self.renderEmpty():$3",
            },
        },
    ],
});
