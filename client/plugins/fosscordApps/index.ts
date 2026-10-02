/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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
import { GuildMemberStore, useStateFromStores } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordApps",
    description: "Keeps app components and the app launcher in step with an instance that has no embedded activities.",
    authors: [FosscordAuthor],
    required: true,

    useMemberVersion() {
        return useStateFromStores([GuildMemberStore], () => (GuildMemberStore as unknown as { getMemberVersion(): number }).getMemberVersion());
    },

    patches: [
        {
            find: "checkRecentlyTalkedOnEmptyQuery:!1,limit:15",
            replacement: {
                match: /(?=return\(0,\i\.jsx\)\(\i,\{selectActionComponent:\i,queryOptions:function\(\i\)\{return function\(\i,\i,\i\)\{let \i=\i\.\i\.getChannel)/,
                replace: "$self.useMemberVersion();",
            },
        },
    ],
});
