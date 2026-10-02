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

import fs from "node:fs/promises";
import path from "node:path";
import { ASSETS_FOLDER } from "./Constants";

export enum CollectibleItemType {
    AVATAR_DECORATION = 0,
    PROFILE_EFFECT = 1,
    NAMEPLATE = 2,
    PROFILE_FRAME = 3,
    BUNDLE = 1000,
    VARIANTS_GROUP = 3000,
}

export interface CollectibleItem {
    type: CollectibleItemType;
    sku_id: string;
    id?: string;
    asset?: string;
    label?: string;
    palette?: string;
    [key: string]: unknown;
}

export interface CollectibleProduct {
    sku_id: string;
    name: string;
    type: CollectibleItemType;
    items: CollectibleItem[];
    category_sku_id?: string;
    bundled_products?: CollectibleProduct[];
    variants?: CollectibleProduct[];
    [key: string]: unknown;
}

export interface CollectibleCategory {
    sku_id: string;
    name: string;
    products: CollectibleProduct[];
    [key: string]: unknown;
}

const CATALOG_URL = process.env.COLLECTIBLES_CATALOG_URL || "https://raw.githubusercontent.com/aamiaa/discord-api-diff/main/collectibles.json";
const CACHE_FILE = path.join(ASSETS_FOLDER, "collectibles.json");

let catalog: Promise<{ categories: CollectibleCategory[]; products: Map<string, CollectibleProduct>; items: Map<string, CollectibleItem> }> | undefined;

const load = async () => {
    let raw = await fs.readFile(CACHE_FILE, "utf8").catch(() => undefined);
    if (!raw) {
        const res = await fetch(CATALOG_URL).catch(() => undefined);
        if (!res?.ok) {
            console.error(`[Collectibles] could not fetch catalog from ${CATALOG_URL}: ${res?.status ?? "network error"}`);
            catalog = undefined;
            return { categories: [], products: new Map<string, CollectibleProduct>(), items: new Map<string, CollectibleItem>() };
        }
        raw = await res.text();
        await fs.writeFile(CACHE_FILE, raw).catch((e) => console.error("[Collectibles] could not cache catalog", e));
    }

    const categories = JSON.parse(raw) as CollectibleCategory[];
    const products = new Map<string, CollectibleProduct>();
    const items = new Map<string, CollectibleItem>();

    const index = (product: CollectibleProduct) => {
        if (!products.has(product.sku_id) || product.items?.some((x) => x.asset || x.effects)) products.set(product.sku_id, product);
        for (const item of product.items ?? []) {
            const known = items.get(item.sku_id);
            if (!known || Object.keys(item).length > Object.keys(known).length) items.set(item.sku_id, item);
        }
        product.bundled_products?.forEach(index);
        product.variants?.forEach(index);
    };
    for (const category of categories) category.products.forEach(index);

    return { categories, products, items };
};

export const Collectibles = {
    get: () => (catalog ??= load()),

    async categories() {
        return (await Collectibles.get()).categories;
    },

    async product(sku_id: string) {
        return (await Collectibles.get()).products.get(sku_id);
    },

    async item(sku_id: string, type: CollectibleItemType) {
        const { items, products } = await Collectibles.get();
        const item = items.get(sku_id) ?? products.get(sku_id)?.items.find((x) => x.type === type);
        return item?.type === type ? item : undefined;
    },

    async owned() {
        const { products } = await Collectibles.get();
        return [...products.values()].filter((x) => x.type !== CollectibleItemType.BUNDLE && x.type !== CollectibleItemType.VARIANTS_GROUP);
    },
};
