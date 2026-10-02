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
import managedStyle from "./style.css?managed";

const AI_ACCOUNT_FLAG = 1 << 30;

export default definePlugin({
    name: "FosscordAiTag",
    description: "Shows the green AI tag, with a check mark when verified, on accounts that have the AI_ACCOUNT public flag instead of the BOT tag.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    patches: [
        {
            find: /\.isSystemUser\(\)\?\i=\i\.\i\.SYSTEM_DM:\i\.bot&&/,
            all: true,
            replacement: {
                match: /(\i)\.bot&&\((\i)=(\i\.\i)\.BOT\)/,
                replace: `($1.publicFlags&${AI_ACCOUNT_FLAG})?$2=$3.AI:$&`,
            },
        },
        {
            find: /\?\.bot\?\i=\i\.\i\.Types\.BOT:/,
            all: true,
            replacement: {
                match: /(\i)\?\.bot\?(\i)=(\i\.\i\.Types)\.BOT:/,
                replace: `($1?.publicFlags&${AI_ACCOUNT_FLAG})?$2=$3.AI:$&`,
            },
        },
        {
            find: "#{intl::g76OcH::raw}",
            replacement: [
                {
                    match: /(\i)=(\i)\.intl\.string\(\2\.t\.g76OcH\),(\i)=(\i\?\i\.\i:\i\.\i);switch\((\i)\)\{case (\i\.\i)\.SYSTEM_DM:/,
                    replace: '$1=$2.intl.string($2.t.g76OcH),$3=$4;if($5===$6.AI){$1="Verified AI";$3+=" fosscord-ai-tag"}switch($5){case $6.SYSTEM_DM:',
                },
                {
                    match: /case (\i\.\i)\.BOT:default:(\i)=/,
                    replace: 'case $1.AI:$2="AI";break;$&',
                },
            ],
        },
    ],
});
