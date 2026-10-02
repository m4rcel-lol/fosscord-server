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

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "collectible_purchases",
})
export class CollectiblePurchase extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @PrimaryColumn({ type: "int8" })
    sku_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_collectible_purchase_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "timestamp with time zone" })
    purchased_at: Date;
}
