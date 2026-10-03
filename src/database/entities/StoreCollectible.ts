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

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClass, BaseClassWithoutId } from "./BaseClass";

// the admin panel's own shop: packs (shop categories) of avatar decorations, profile effects, nameplates and profile
// frames, listed next to the catalog mirrored from discord. Ids double as SKU ids, and art lives on the CDN under
// media/v1/collectibles-shop/<sku id>/..., where the client looks for collectible art
@Entity({
    name: "store_packs",
})
export class StorePack extends BaseClass {
    @Column()
    name: string;

    @Column({ type: "text", default: "" })
    summary: string = "";

    // hashes of the uploaded art, also used to bust caches when it changes
    @Column({ type: "character varying", nullable: true })
    banner_hash?: string | null;

    @Column({ type: "character varying", nullable: true })
    logo_hash?: string | null;

    @Column({ type: "int", default: 0 })
    position: number = 0;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();
}

export interface StoreItemData {
    // uploaded art by slot (static, animated, video, thumbnail, layer ids...) -> content hash
    assets?: Record<string, string>;
    palette?: string; // nameplates
    duration?: number; // profile effects, ms
    loop?: boolean; // profile effects
    overflow_top?: number; // profile frames
    overflow_bottom?: number; // profile frames
    layers?: { id: string; order: "front" | "back"; anchor: "top" | "bottom" }[]; // profile frames
}

@Entity({
    name: "store_items",
})
export class StoreItem extends BaseClass {
    @Column({ type: "int8", foreignKeyConstraintName: "FK_store_items_pack_id" })
    @Index("IDX_store_items_pack_id")
    pack_id: string;

    @JoinColumn({ name: "pack_id", foreignKeyConstraintName: "FK_store_items_pack_id" })
    @ManyToOne(() => StorePack, { onDelete: "CASCADE" })
    pack: StorePack;

    @Column({ type: "int" })
    type: number; // CollectibleItemType: 0 avatar decoration, 1 profile effect, 2 nameplate, 3 profile frame

    @Column()
    name: string;

    @Column({ type: "text", default: "" })
    summary: string = "";

    // read out by screen readers
    @Column({ type: "text", default: "" })
    label: string = "";

    @Column({ type: "jsonb", default: {} })
    data: StoreItemData = {};

    @Column({ type: "int", default: 0 })
    position: number = 0;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();
}

// a pack of the mirrored discord catalog the admins took out of the shop; people who already have its items keep them
@Entity({
    name: "store_hidden_packs",
})
export class StoreHiddenPack extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    sku_id: string;
}
