/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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

export interface ApplicationAssetCreateSchema {
    /**
     * @minLength 1
     * @maxLength 32
     */
    name: string;
    type?: number;
    image: string;
}

export interface ApplicationTesterAddSchema {
    /**
     * @minLength 1
     * @maxLength 32
     */
    username: string;
    discriminator?: string | null;
}

export interface ApplicationProxyMapping {
    /**
     * @minLength 1
     * @maxLength 256
     */
    prefix: string;
    /**
     * @minLength 1
     * @maxLength 256
     */
    target: string;
}

export interface ApplicationProxyConfigSchema {
    /**
     * @maxItems 50
     */
    url_map: ApplicationProxyMapping[];
}

export interface EmbeddedActivityConfigModifySchema {
    activity_preview_video_asset_id?: string | null;
    supported_platforms?: string[] | null;
    default_orientation_lock_state?: number;
    tablet_default_orientation_lock_state?: number;
    requires_age_gate?: boolean;
    shelf_rank?: number;
}
