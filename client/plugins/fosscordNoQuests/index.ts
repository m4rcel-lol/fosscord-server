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

import { FosscordAuthor, redirectHome } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordNoQuests",
    description: "Removes Quests, Orbs and sponsored content from the client.",
    authors: [FosscordAuthor],
    required: true,

    redirectHome,

    patches: [
        {
            find: '"nitro-tab-group"',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i,\{selected:\i\.startsWith\(\i\.\i\.QUEST_HOME\)\},"quests"\)/,
                replace: "null",
            },
        },
        {
            find: "QUEST_HOME_DEPRECATED,render:",
            replacement: {
                match: /(path:\i\.\i\.QUEST_HOME,render:)\i/,
                replace: "$1$self.redirectHome",
            },
        },
        {
            find: ".DISCOVERY_QUEST_TAB_CLICKED,{",
            replacement: {
                match: /(function \i\((\i)\)\{)(let\{tab:\i\}=\i,\i=\i\.\i\.useField\("selectedTab"\).{0,200}?case (\i\.GlobalDiscoveryTab)\.QUESTS:)/,
                replace: "$1if($2.tab===$4.QUESTS)return null;$3",
            },
        },
        {
            find: "topLevelRoute:!1})",
            replacement: {
                match: /(case (\i\.GlobalDiscoveryTab)\.SERVERS:return(\(0,\i\.jsx\)\(\i,\{\}\));.{0,80}?case \2\.QUESTS:return)\(0,\i\.jsx\)\(\i\.default,\{topLevelRoute:!1\}\)/,
                replace: "$1$3",
            },
        },
        {
            find: "queryInAppNavigations(",
            replacement: {
                match: /(\[\i\.\i\.(?:SHOP_ORBS_TAB|QUEST_ORBS|QUEST_HOME)\]:)\[(?:\i\.intl\.string\(\i\.t(?:\.[\w$]+|\["[^"]+"\])\),?)+\]/g,
                replace: "$1null",
            },
        },
    ],
});
