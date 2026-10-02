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

import { FosscordAuthor, hideSetting } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordNoDataCollection",
    description: "This instance does no analytics, personalization or sponsored content, so the toggles for them are hidden.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: ".DATA_USAGE_STATISTICS_SETTING,{",
            replacement: [
                hideSetting("DATA_USAGE_STATISTICS_SETTING"),
                hideSetting("DATA_USAGE_QUESTS_SETTING", { replacesPredicate: true }),
                hideSetting("DATA_USAGE_QUESTS_3P_SETTING", { replacesPredicate: true }),
                hideSetting("SPONSORED_CONTENT_QUESTS_SETTING", { replacesPredicate: true }),
                hideSetting("SPONSORED_CONTENT_QUESTS_3P_SETTING", { replacesPredicate: true }),
            ],
        },
        {
            find: ".DATA_USAGE_PERSONALIZATION_SETTING,{",
            replacement: hideSetting("DATA_USAGE_PERSONALIZATION_SETTING"),
        },
    ],
});
