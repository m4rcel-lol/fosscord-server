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

import { MigrationInterface, QueryRunner } from "typeorm";

export class SoundboardFavoriteOrder1791448273615 implements MigrationInterface {
    name = "SoundboardFavoriteOrder1791448273615";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "user_settings_protos"
            SET "frecencySettings" = jsonb_set("frecencySettings"::jsonb, '{favoriteSoundboardSounds,orderedSoundIds}', "frecencySettings"::jsonb #> '{favoriteSoundboardSounds,soundIds}')::text
            WHERE "frecencySettings" IS NOT NULL
                AND jsonb_typeof("frecencySettings"::jsonb #> '{favoriteSoundboardSounds,soundIds}') = 'array'
                AND jsonb_array_length("frecencySettings"::jsonb #> '{favoriteSoundboardSounds,soundIds}') > 0
                AND COALESCE(jsonb_array_length("frecencySettings"::jsonb #> '{favoriteSoundboardSounds,orderedSoundIds}'), 0) = 0`,
        );
    }

    public async down(): Promise<void> {}
}
