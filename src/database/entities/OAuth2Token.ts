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

import { Column, Entity, Index, JoinColumn, ManyToOne, RelationId } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { Application } from "./Application";
import { ApplicationAuthorization } from "./ApplicationAuthorization";

@Entity({
    name: "oauth2_tokens",
})
@Index("IDX_oauth2_token_user_application", ["user_id", "application_id"])
export class OAuth2Token extends BaseClass {
    @Column()
    @RelationId((token: OAuth2Token) => token.user)
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_oauth2_token_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    @RelationId((token: OAuth2Token) => token.application)
    application_id: string;

    @JoinColumn({ name: "application_id", foreignKeyConstraintName: "FK_oauth2_token_application_id" })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @Column({ nullable: true })
    @RelationId((token: OAuth2Token) => token.authorization)
    authorization_id?: string;

    @JoinColumn({ name: "authorization_id", foreignKeyConstraintName: "FK_oauth2_token_authorization_id" })
    @ManyToOne(() => ApplicationAuthorization, { onDelete: "CASCADE", nullable: true })
    authorization?: ApplicationAuthorization;

    @Column({ type: "jsonb", default: [] })
    scopes: string[];

    @Index("IDX_oauth2_token_access_token_hash", { unique: true })
    @Column()
    access_token_hash: string;

    @Index("IDX_oauth2_token_refresh_token_hash", { unique: true })
    @Column({ type: "varchar", nullable: true })
    refresh_token_hash: string | null;

    @Index("IDX_oauth2_token_code_hash", { unique: true })
    @Column({ type: "varchar", nullable: true })
    code_hash: string | null;

    @Column({ type: "timestamp with time zone" })
    expires_at: Date;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    created_at: Date;
}
