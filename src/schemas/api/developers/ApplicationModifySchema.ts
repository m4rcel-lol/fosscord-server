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

export interface ApplicationModifySchema {
    /**
     * @maxLength 400
     */
    description?: string;
    icon?: string;
    cover_image?: string;
    interactions_endpoint_url?: string | null;
    max_participants?: number | null;
    name?: string;
    /**
     * @maxLength 2048
     */
    privacy_policy_url?: string | null;
    role_connections_verification_url?: string;
    /**
     * @maxItems 5
     */
    tags?: string[];
    /**
     * @maxLength 2048
     */
    terms_of_service_url?: string | null;
    bot_public?: boolean;
    bot_require_code_grant?: boolean;
    flags?: number;
    custom_install_url?: string | null;
    guild_id?: string;
    /**
     * @maxItems 10
     */
    redirect_uris?: string[];
    integration_types_config?: {
        "0"?: ApplicationIntegrationTypeConfig;
        "1"?: ApplicationIntegrationTypeConfig;
    };
    /*install_params?: { TODO: Validation
		scopes: string[];
		permissions: string;
	};*/
}

export interface ApplicationIntegrationTypeConfig {
    oauth2_install_params?: {
        scopes: string[];
        permissions: string;
    } | null;
}
