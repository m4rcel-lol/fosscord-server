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
import { Text } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

export default definePlugin({
    name: "FosscordViolations",
    description: 'Shows what staff wrote about a violation under "You broke the rules for" in its popup on the Account Standing page.',
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    renderStaffMessage(classification: { staff_message?: string } | null | undefined) {
        if (!classification?.staff_message) return null;
        return (
            <Text variant="text-md/normal" color="text-default" className="fosscord-violation-message">
                {classification.staff_message}
            </Text>
        );
    },

    patches: [
        {
            // the violation popup's heading; the server sends the rule as description and the staff's words as staff_message
            find: /classificationTypeText:\i\.description,guildMetadata:/,
            replacement: {
                match: /\(0,(\i)\.jsx\)\(\i,\{classificationTypeText:(\i)\.description,guildMetadata:\2\?\.guild_metadata\}\)/,
                replace: "(0,$1.jsxs)($1.Fragment,{children:[$&,$self.renderStaffMessage($2)]})",
            },
        },
    ],
});
