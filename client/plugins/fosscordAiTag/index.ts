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

const OFFICIAL_TAG_FLAG = 1 << 28;
const SYSTEM_TAG_FLAG = 1 << 29;
const AI_ACCOUNT_FLAG = 1 << 30;
// discord's tag types have no SYSTEM (it draws system dms as OFFICIAL), so the tag component gets its own case for this one
const SYSTEM_TAG_TYPE = "FOSSCORD_SYSTEM";

export default definePlugin({
    name: "FosscordAiTag",
    description:
        "Shows the ✓ OFFICIAL and ✓ SYSTEM tags on accounts with the OFFICIAL_TAG and SYSTEM_TAG public flags, and the green AI tag, with a check mark when verified, on accounts with the AI_ACCOUNT public flag instead of the BOT tag.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    // the tag type an account's public flags ask for, or undefined to leave discord's choice alone
    tagType(user: { publicFlags?: number } | null | undefined, types: Record<string, unknown>) {
        const flags = user?.publicFlags ?? 0;
        if (flags & OFFICIAL_TAG_FLAG) return types.OFFICIAL;
        if (flags & SYSTEM_TAG_FLAG) return SYSTEM_TAG_TYPE;
        if (flags & AI_ACCOUNT_FLAG) return types.AI;
    },

    patches: [
        {
            find: /\.isSystemUser\(\)\?\i=\i\.\i\.SYSTEM_DM:\i\.bot&&/,
            all: true,
            replacement: {
                match: /(\i)\.bot&&\((\i)=(\i\.\i)\.BOT\)/,
                replace: "($2=$self.tagType($1,$3))??($&)",
            },
        },
        {
            find: /\?\.bot\?\i=\i\.\i\.Types\.BOT:/,
            all: true,
            replacement: {
                match: /(\i)\?\.bot\?(\i)=(\i\.\i\.Types)\.BOT:/,
                replace: "$self.tagType($1,$3)!=null?$2=$self.tagType($1,$3):$&",
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
                    // same check mark and tooltip as OFFICIAL, with discord's own translated "SYSTEM" label
                    match: /case \i\.\i\.OFFICIAL:(\i)=!0,(\i)=(\i)\.intl\.string\(\3\.t\["7s687k"\]\),(\i)=\3\.intl\.string\(\3\.t\.lKQ7Wt\);break;/,
                    replace: `$&case "${SYSTEM_TAG_TYPE}":$1=!0,$2=$3.intl.string($3.t["7s687k"]),$4=$3.intl.string($3.t["r73Lz/"]);break;`,
                },
                {
                    match: /case (\i\.\i)\.BOT:default:(\i)=/,
                    replace: 'case $1.AI:$2="AI";break;$&',
                },
            ],
        },
    ],
});
