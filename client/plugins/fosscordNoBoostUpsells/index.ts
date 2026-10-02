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

const INCLUDED_IN_BOOSTING = "#{intl::hUgjyP::raw}";
const SHOW_BOOST_PROGRESS_BAR = "#{intl::Dl4mJS::raw}";

export default definePlugin({
    name: "FosscordNoBoostUpsells",
    description: "Every server is already boost level 3 here, so this removes Server Boost adverts and shows boost perks as unlocked.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: 'key:"download",iconUrl:',
            replacement: {
                match: /=\i\?(?=\{key:"boost")/,
                replace: "=!1?",
            },
        },
        {
            find: /\.push\(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR\)/,
            replacement: [
                {
                    match: /\i(?=&&\i\.push\(\i\.\i\.GUILD_BOOSTS\))/,
                    replace: "!1",
                },
                {
                    match: /\i\.premiumProgressBarEnabled(?=&&\i>0&&\i\.push\(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR\))/,
                    replace: "!1",
                },
            ],
        },
        {
            find: 'id:"premium-subscribe",',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{id:"premium-subscribe",/,
                replace: "null&&$&",
            },
        },
        {
            find: INCLUDED_IN_BOOSTING,
            replacement: {
                match: /=function\(\i\)\{(?=let \i,\i,\i,\{guildFeature:)/,
                replace: "$&return null;",
            },
        },
        {
            find: SHOW_BOOST_PROGRESS_BAR,
            replacement: {
                match: /\(0,\i\.jsx\)\(\i,\{canManageGuild:\i,premiumProgressBarEnabled:\i\.premiumProgressBarEnabled\}\),\(0,\i\.jsx\)\("div",\{className:\i\.\i\}\),/,
                replace: "",
            },
        },
        {
            find: "renderTierNone(){",
            replacement: [
                {
                    match: /renderProgressBar\(\i\)\{/,
                    replace: "$&return null;",
                },
                {
                    match: /0===\i\?this\.renderTierNone\(\):this\.renderSubscribers\(\)/,
                    replace: "null",
                },
            ],
        },
    ],
});
