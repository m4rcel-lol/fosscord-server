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

const CLYDE = "M26.242 2.01A25.218 25.218 0 0 0 19.851 0a18.718 18.718 0 0 0-.819 1.701 23.45 23.45 0 0 0-7.083 0A18.2 18.2 0 0 0 11.121 0a25.13 25.13 0 0 0-6.396 2.015C.68 8.132-.417 14.097.132 19.978c2.682 2.005 5.282 3.223 7.838 4.02A19.514 19.514 0 0 0 9.65 21.23a16.507 16.507 0 0 1-2.644-1.287c.222-.165.439-.337.648-.513 5.098 2.386 10.636 2.386 15.673 0 .211.177.428.348.648.513-.839.505-1.726.939-2.649 1.29A19.432 19.432 0 0 0 23.004 24c2.558-.797 5.16-2.015 7.843-4.022.643-6.817-1.099-12.728-4.605-17.968ZM10.343 16.361c-1.53 0-2.785-1.43-2.785-3.17 0-1.741 1.228-3.174 2.785-3.174 1.557 0 2.812 1.43 2.785 3.174.003 1.74-1.228 3.17-2.785 3.17Zm10.293 0c-1.53 0-2.786-1.43-2.786-3.17 0-1.741 1.228-3.174 2.785-3.174 1.557 0 2.812 1.43 2.785 3.174 0 1.74-1.228 3.17-2.785 3.17Z";

const instanceName = () => String((window as any).GLOBAL_ENV?.INSTANCE_NAME || "Fosscord").replace(/['"\\<>]/g, "");

export default definePlugin({
    name: "FosscordBranding",
    description: "Uses this instance's name instead of Discord, in every translated string and on the sign-in pages, and Premium instead of Nitro.",
    authors: [FosscordAuthor],
    required: true,

    renderWordmark: (className: string) => (
        <div className={className} style={{ display: "flex", alignItems: "center", gap: 10, height: 24, color: "#fff", fontFamily: 'var(--font-display, "gg sans", sans-serif)', fontSize: 20, fontWeight: 800, lineHeight: "24px" }}>
            <svg width="31" height="24" viewBox="0 0 31 24" aria-hidden="true">
                <path fill="currentColor" d={CLYDE} />
            </svg>
            {instanceName()}
        </div>
    ),

    patches: [
        {
            find: "setAuthLogoHidden=",
            replacement: {
                match: /(\i\?null:)\(0,\i\.jsx\)\("img",\{className:(\i\.\i),src:\i,alt:""\}\)/,
                replace: "$1$self.renderWordmark($2)",
            },
        },
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
                    match: /(["> ])Discord(?=['’]s|[ ."<,!?:]|\\u2019|\\u2014|\\'|-|\))/g,
                    replace: (_, before) => `${before}${instanceName()}`,
                },
            ],
        },
    ],
});
