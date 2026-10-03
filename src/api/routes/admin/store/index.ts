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

import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { StoreHiddenPack, StoreItem, StorePack } from "@spacebar/database";
import { Collectibles, CollectibleItemType } from "@spacebar/util";
import { EFFECT_HEIGHT, EFFECT_WIDTH, FRAME_INNER_WIDTH, FRAME_OVERFLOW_HORIZONTAL, NAMEPLATE_PALETTES, serializeStorePack } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const COUNTED_TYPES = [CollectibleItemType.AVATAR_DECORATION, CollectibleItemType.PROFILE_EFFECT, CollectibleItemType.NAMEPLATE, CollectibleItemType.PROFILE_FRAME];

router.get(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "The store's own packs and items, and the mirrored discord packs with whether each is in the shop" }),
    async (req: Request, res: Response) => {
        const [packs, items, hidden, builtin] = await Promise.all([StorePack.find(), StoreItem.find(), StoreHiddenPack.find(), Collectibles.builtinCategories()]);
        const hiddenSkus = new Set(hidden.map((x) => x.sku_id));
        res.json({
            packs: packs.sort((a, b) => a.position - b.position || +a.created_at - +b.created_at).map((pack) => serializeStorePack(pack, items)),
            builtin: builtin
                .filter((category) => category.products.length)
                .map((category) => ({
                    sku_id: category.sku_id,
                    name: category.name,
                    logo: category.logo_url ?? null,
                    banner: category.catalog_banner_url ?? category.hero_banner_url ?? null,
                    // counted by what's in them, bundles included
                    items: category.products.reduce((sum, product) => sum + (product.items ?? []).filter((item) => COUNTED_TYPES.includes(item.type)).length, 0),
                    hidden: hiddenSkus.has(category.sku_id),
                })),
            palettes: NAMEPLATE_PALETTES,
            sizes: {
                effect: { width: EFFECT_WIDTH, height: EFFECT_HEIGHT },
                frame: { width: FRAME_INNER_WIDTH + FRAME_OVERFLOW_HORIZONTAL * 2, inner_width: FRAME_INNER_WIDTH },
            },
        });
    },
);

export default router;
