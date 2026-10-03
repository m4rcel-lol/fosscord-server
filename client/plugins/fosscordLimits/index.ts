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
    name: "FosscordLimits",
    description: "Uses this instance's group DM size, set by the server, instead of Discord's 10 (or 25 for some Nitro users).",
    authors: [FosscordAuthor],
    required: true,

    groupDmRecipientLimit() {
        return Number((window as { GLOBAL_ENV?: { GROUP_DM_RECIPIENT_LIMIT?: number } }).GLOBAL_ENV?.GROUP_DM_RECIPIENT_LIMIT) || 25;
    },

    patches: [
        {
            // how many people the client lets into a group DM
            find: '"getGroupDMRecipientLimit"',
            all: true,
            replacement: {
                match: /return (\i)\?\.isStaff\(\)\?\i\.\i:\i&&\(0,\i\.\i\)\(\1,\i\.PremiumTypes\.TIER_2\)&&\(0,\i\.\i\)\("getGroupDMRecipientLimit"\)\.enabled\?25:\i\.\i/,
                replace: "return $self.groupDmRecipientLimit()",
            },
        },
    ],
});
