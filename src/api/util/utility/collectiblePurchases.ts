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

import { CollectiblePurchase } from "@spacebar/database";
import { CollectibleItemType, Collectibles, DiscordApiErrors } from "@spacebar/util";

export const listCollectiblePurchases = async (user_id: string) => {
    const purchases = await CollectiblePurchase.find({ where: { user_id }, order: { purchased_at: "DESC" } });
    const owned = await Promise.all(
        purchases.map(async ({ sku_id, purchased_at }) => {
            const product = await Collectibles.product(sku_id);
            if (!product || product.type === CollectibleItemType.BUNDLE || product.type === CollectibleItemType.VARIANTS_GROUP) return undefined;
            return { ...product, purchased_at: purchased_at.toISOString(), purchase_type: 0, expires_at: null };
        }),
    );
    return owned.filter((x) => x !== undefined);
};

export const grantCollectible = async (user_id: string, sku_id: string) => {
    const sku_ids = await Collectibles.grantable(sku_id);
    if (!sku_ids.length) throw DiscordApiErrors.UNKNOWN_SKU;
    const purchased_at = new Date();
    await CollectiblePurchase.createQueryBuilder()
        .insert()
        .values(sku_ids.map((sku) => ({ user_id, sku_id: sku, purchased_at })))
        .orIgnore()
        .execute();
    return listCollectiblePurchases(user_id);
};
