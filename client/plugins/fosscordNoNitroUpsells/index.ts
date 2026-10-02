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

import { FosscordAuthor, hideSetting, redirectHome } from "../fosscordCore/shared";

const MAKE_IT_YOURS_ONLY_WITH_PREMIUM = "#{intl::np0X/u::raw}";

export default definePlugin({
    name: "FosscordNoNitroUpsells",
    description: "Everyone already has Nitro here, so this removes every Nitro advert, trial, gift prompt and billing page.",
    authors: [FosscordAuthor],
    required: true,

    redirectHome,

    patches: [
        {
            find: '"nitro-tab-group"',
            replacement: {
                match: /\i\?(?=\(0,\i\.jsxs\)\("div",\{children:\[\(0,\i\.jsx\)\(\i,\{nitroTabButtonRef:)/,
                replace: "!1?",
            },
        },
        {
            find: "QUEST_HOME_DEPRECATED,render:",
            replacement: {
                match: /(path:\i\.\i\.APPLICATION_STORE,render:)\i/,
                replace: "$1$self.redirectHome",
            },
        },
        {
            find: ".BILLING_SECTION,{",
            replacement: [
                hideSetting("BILLING_SECTION"),
                hideSetting("ACCOUNT_FAMILY_CENTER_CATEGORY"),
                {
                    match: /(\.APPEARANCE_IN_APP_ICON_CATEGORY,\{.{0,120}?)useSubtitle:\(\)=>[^,]+?,(?=useHeaderDecoration)/,
                    replace: "$1",
                },
            ],
        },
        {
            find: ".COLLECTIBLES_PROFILE_SETTINGS_UPSELL),",
            replacement: {
                match: /=function\(\)\{(?=let [^;]{0,80}?=\(0,\i\.\i\)\(\i\.\i\.COLLECTIBLES_PROFILE_SETTINGS_UPSELL\))/,
                replace: "$&return null;",
            },
        },
        {
            find: ".APPEARANCE_CUSTOM_THEMES_UPSELL,{",
            replacement: hideSetting("APPEARANCE_CUSTOM_THEMES_UPSELL", { replacesPredicate: true }),
        },
        {
            find: MAKE_IT_YOURS_ONLY_WITH_PREMIUM,
            replacement: {
                match: /(let (\i)=\(0,\i\.\i\)\(\{type:\i,isPreview:\i,isCoachmark:\i\}\).{0,600}?\.otherwise\(\(\)=>)\i\.intl\.string\(\i\.t\["np0X\/u"\]\)\);/,
                replace: "$1null);if($2==null)return null;",
            },
        },
        {
            find: '"sticker")',
            replacement: {
                match: /\i\.gifts\?\.button!=null(?=&&)/,
                replace: "!1",
            },
        },
        {
            find: "queryInAppNavigations(",
            replacement: {
                match: /(\[\i\.\i\.NITRO_HOME\]:)\[(?:\i\.intl\.string\(\i\.t(?:\.[\w$]+|\["[^"]+"\])\),?)+\]/,
                replace: "$1null",
            },
        },
    ],
});
