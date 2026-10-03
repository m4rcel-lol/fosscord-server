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

// sounds this instance replaces, served from assets/public/sounds
const RINGTONE = "/assets/sounds/call_ringing.mp3";

export default definePlugin({
    name: "FosscordSounds",
    description: "Plays this instance's own ringtone for incoming calls, including the seasonal and rare variants of it.",
    authors: [FosscordAuthor],
    required: true,

    soundUrl(name: string) {
        return name.startsWith("call_ringing") ? RINGTONE : undefined;
    },

    patches: [
        {
            // every sound the client plays goes through here: new Audio with src from the bundled mp3s
            find: /new Audio;\i\.src=\i\(\d+\)\(`\.\/\$\{this\.name\}\.mp3`\)/,
            replacement: {
                match: /(\i)\.src=(\i\(\d+\)\(`\.\/\$\{this\.name\}\.mp3`\))/,
                replace: "$1.src=$self.soundUrl(this.name)??$2",
            },
        },
    ],
});
