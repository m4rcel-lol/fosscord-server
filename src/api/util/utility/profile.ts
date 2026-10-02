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

import { Member, User } from "@spacebar/database";
import { CollectibleItemType, Collectibles, FieldErrors } from "@spacebar/util";
import { ProfileCollectible } from "@spacebar/schemas";

export const profileMetadata = (source: User | Member) => {
    const collectibles = source.profile_collectibles ?? [];
    const effect = collectibles.find((x) => x.type === CollectibleItemType.PROFILE_EFFECT);
    return {
        ...(source instanceof Member ? { guild_id: source.guild_id } : {}),
        bio: source.bio ?? "",
        accent_color: source instanceof User ? (source.accent_color ?? null) : null,
        banner: source.banner ?? null,
        pronouns: source.pronouns ?? "",
        theme_colors: source.theme_colors?.length ? source.theme_colors.map(Number) : null,
        popout_animation_particle_type: null,
        emoji: null,
        profile_effect: effect ? { id: effect.sku_id, expires_at: null } : null,
        collectibles,
    };
};

export const resolveProfileCollectibles = async (current: ProfileCollectible[] | null | undefined, sku_ids?: string[] | null, profile_effect_id?: string | null) => {
    let next = sku_ids === undefined ? [...(current ?? [])] : [];
    for (const sku_id of sku_ids ?? []) {
        const item = (await Collectibles.item(sku_id, CollectibleItemType.PROFILE_EFFECT)) ?? (await Collectibles.item(sku_id, CollectibleItemType.PROFILE_FRAME));
        if (!item) throw FieldErrors({ collectibles_sku_ids: { code: "50057", message: "Invalid SKU" } });
        next = next.filter((x) => x.type !== item.type);
        next.push({ sku_id: item.sku_id, type: item.type, expires_at: null });
    }
    if (profile_effect_id !== undefined) {
        next = next.filter((x) => x.type !== CollectibleItemType.PROFILE_EFFECT);
        if (profile_effect_id) {
            const effect = await Collectibles.item(profile_effect_id, CollectibleItemType.PROFILE_EFFECT);
            if (!effect) throw FieldErrors({ profile_effect_id: { code: "50057", message: "Invalid SKU" } });
            next.push({ sku_id: effect.sku_id, type: effect.type, expires_at: null });
        }
    }
    return next;
};
