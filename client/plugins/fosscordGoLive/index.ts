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

type Constraint = number | { ideal?: number; max?: number } | undefined;
type Quality = { width?: number; height?: number; framerate?: number };
type StreamParameter = { quality?: number; maxResolution?: { type: string; width: number; height: number }; maxFrameRate?: number };

const constraintValue = (value: Constraint) => (typeof value === "number" ? value : (value?.ideal ?? value?.max));

export default definePlugin({
    name: "FosscordGoLive",
    description: "Announces the resolution and frame rate a browser Go Live stream really captures, so viewers see the right quality.",
    authors: [FosscordAuthor],
    required: true,

    withFrameRate(quality: Quality, constraints: { frameRate?: Constraint }) {
        const framerate = constraintValue(constraints.frameRate);
        if (framerate != null) quality.framerate = framerate;
    },

    syncStreamParameters(connection: { videoStreamParameters?: StreamParameter[] }, { width, height, framerate }: Quality) {
        if (!connection.videoStreamParameters) return;
        connection.videoStreamParameters = connection.videoStreamParameters.map((parameter) =>
            parameter.quality === 100
                ? {
                      ...parameter,
                      maxResolution: height ? { type: "fixed", width: width ?? Math.round((height / 9) * 16), height } : { type: "source", width: 0, height: 0 },
                      ...(framerate != null && { maxFrameRate: framerate }),
                  }
                : parameter,
        );
    },

    patches: [
        {
            find: "setDesktopInput=",
            replacement: {
                match: /(let (\i)=\i\.stream\.getVideoTracks\(\)\[0\]\.getConstraints\(\),(\i)=\{width:.+?)(this\.videoQualityManager\.setGoliveQuality\(\{encode:\3,capture:\3,bitrateMax:\i\}\))/,
                replace: "$1$self.withFrameRate($3,$2),$4,$self.syncStreamParameters(this,$3)",
            },
        },
    ],
});
