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

import { In } from "typeorm";
import { Application, Member } from "@spacebar/database";

export function toPublicApplication(app: Application) {
    return {
        id: app.id,
        name: app.name,
        icon: app.icon ?? null,
        description: app.description ?? "",
        summary: app.summary ?? "",
        type: null,
        cover_image: app.cover_image ?? undefined,
        flags: app.flags ?? 0,
        hook: app.hook,
        bot_public: app.bot_public ?? true,
        bot_require_code_grant: app.bot_require_code_grant ?? false,
        verify_key: app.verify_key,
        tags: app.tags ?? [],
        guild_id: app.guild_id ?? undefined,
        terms_of_service_url: app.terms_of_service_url ?? undefined,
        privacy_policy_url: app.privacy_policy_url ?? undefined,
        custom_install_url: app.custom_install_url ?? undefined,
        install_params: app.install_params ?? { scopes: ["bot", "applications.commands"], permissions: "0" },
        integration_types_config: {
            "0": { oauth2_install_params: app.install_params ?? { scopes: ["bot", "applications.commands"], permissions: "0" } },
            "1": { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } },
        },
        is_monetized: false,
        is_verified: false,
        is_discoverable: true,
        storefront_available: false,
        ...(app.bot && { bot: app.bot.toPublicUser() }),
    };
}

export async function findPublicApplications(ids: string[]) {
    if (!ids.length) return [];
    const apps = await Application.find({ where: { id: In(ids) }, relations: { bot: true } });
    return apps.map(toPublicApplication);
}

export async function toDirectoryApplication(app: Application) {
    const guildCount = app.bot ? await Member.count({ where: { id: app.bot.id } }) : 0;
    return {
        ...toPublicApplication(app),
        categories: [],
        directory_entry: {
            guild_count: guildCount,
            detailed_description: app.description ?? "",
            short_description: app.summary || app.description || "",
            supported_locales: ["en-US"],
            carousel_items: [],
            popular_application_command_ids: [],
            external_urls: [],
            type: 1,
        },
        external_assets: [],
    };
}

export async function profileApplication(botId: string) {
    const app = await Application.findOne({ where: { id: botId } });
    if (!app) return undefined;
    const pub = toPublicApplication(app);
    return {
        id: app.id,
        flags: pub.flags,
        verified: false,
        popular_application_command_ids: [],
        custom_install_url: pub.custom_install_url,
        install_params: pub.install_params,
        integration_types_config: pub.integration_types_config,
        storefront_available: false,
    };
}
