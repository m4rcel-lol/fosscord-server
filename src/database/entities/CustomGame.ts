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

import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";

// a game the instance's admins added; it shows up next to discord's detectable games wherever users pick games,
// such as the games on their profile or their server's profile
@Entity({
    name: "custom_games",
})
export class CustomGame extends BaseClass {
    @Column()
    name: string;

    @Column({ type: "jsonb", default: [] })
    aliases: string[] = [];

    @Column({ type: "character varying", nullable: true })
    icon_hash?: string | null;

    @Column({ type: "character varying", nullable: true })
    cover_image_hash?: string | null;

    @Column({ type: "int8", nullable: true })
    created_by?: string | null;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();
}
