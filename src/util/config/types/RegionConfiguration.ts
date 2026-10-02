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

import { ConfigVoiceRegion } from "@spacebar/schemas";

export class RegionConfiguration {
    default: string = "spacebar";
    useDefaultAsOptimal: boolean = true;
    available: ConfigVoiceRegion[] = [
        {
            id: "spacebar",
            name: "spacebar",
            // the bundle serves voice on its own port under /voice unless WRTC_WS_PORT gives voice a separate one
            endpoint: process.env.WRTC_WS_PORT ? `127.0.0.1:${process.env.WRTC_WS_PORT}` : `127.0.0.1:${process.env.PORT || 3001}/voice`,
            vip: false,
            custom: false,
            deprecated: false,
        },
    ];
}
