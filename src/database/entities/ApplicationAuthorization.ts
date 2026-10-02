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

import { Column, Entity, JoinColumn, ManyToOne, RelationId, Unique } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { Application } from "./Application";

@Entity({
    name: "application_authorizations",
})
@Unique("UQ_application_authorization_user_application", ["user", "application"])
export class ApplicationAuthorization extends BaseClass {
    @Column()
    @RelationId((authorization: ApplicationAuthorization) => authorization.user)
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_application_authorization_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    @RelationId((authorization: ApplicationAuthorization) => authorization.application)
    application_id: string;

    @JoinColumn({ name: "application_id", foreignKeyConstraintName: "FK_application_authorization_application_id" })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @Column({ type: "jsonb", default: [] })
    scopes: string[];

    @Column({ default: 1 })
    integration_type: number;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    created_at: Date;
}
