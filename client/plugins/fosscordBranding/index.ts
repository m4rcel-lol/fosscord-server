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

const instanceName = () => String((window as any).GLOBAL_ENV?.INSTANCE_NAME || "Fosscord").replace(/['"\\<>]/g, "");

const LOGO_PATH =
    "M3.21 4.84C3.44 3.71 4.58 3.24 5.51 3.78L12 7.59L18.49 3.78C19.42 3.24 20.56 3.71 20.79 4.84L22.8 14.61C23.5 17.82 21.06 20.56 17.78 20.56L6.22 20.56C2.94 20.56 .5 17.82 1.2 14.61ZM7.35 11.06a1.27 1.27 0 0 0-1.27 1.27v2.64a1.27 1.27 0 0 0 1.27 1.27h2.67a1.27 1.27 0 0 0 1.27-1.27v-2.64a1.27 1.27 0 0 0-1.27-1.27ZM13.97 11.06a1.27 1.27 0 0 0-1.27 1.27v2.64a1.27 1.27 0 0 0 1.27 1.27h2.67a1.27 1.27 0 0 0 1.27-1.27v-2.64a1.27 1.27 0 0 0-1.27-1.27Z";

export default definePlugin({
    name: "FosscordBranding",
    description: "Uses this instance's name and logo instead of Discord's, and Premium instead of Nitro, in every translated string.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: /JSON\.parse\('\{"[\w+/]{6}":\["/,
            all: true,
            noWarn: true,
            replacement: [
                {
                    match: /Discord Nitro/g,
                    replace: () => `${instanceName()} Premium`,
                },
                {
                    match: /(["> ])Nitro(?=[ ."<,!?])/g,
                    replace: "$1Premium",
                },
                {
                    match: /"Qq\+A6i":\["Scan this with the ",\[8,"\$b",\["[^"]*"\]\]," to log in instantly\."\]/,
                    replace: () => `"Qq+A6i":["Scan this with the camera of a phone that is ",[8,"$b",["logged in to ${instanceName()}"]]," to log in instantly."]`,
                },
                {
                    match: /(["> ])Discord(?=['’]s|[ ."<,!?:]|\\u2019|\\u2014|\\'|-|\))/g,
                    replace: (_, before) => `${before}${instanceName()}`,
                },
            ],
        },
        {
            find: 'd:"M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44',
            all: true,
            replacement: {
                match: /d:"M19\.73 4\.87a18\.2 18\.2 0 0 0-4\.6-1\.44[^"]*"/,
                replace: () => `d:"${LOGO_PATH}"`,
            },
        },
        {
            find: ".APPEARANCE_IN_APP_ICON_CATEGORY,{useTitle:",
            replacement: hideSetting("APPEARANCE_IN_APP_ICON_CATEGORY"),
        },
    ],
});
