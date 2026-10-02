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

import crypto from "node:crypto";
import { Raw } from "typeorm";
import { HTTPError } from "lambert-server/HTTPError";
import { Guild, User } from "@spacebar/database";

export interface GuildTagChanges {
    tag?: string | null;
    badge?: number | null;
    badge_color_primary?: string | null;
    badge_color_secondary?: string | null;
}

/**
 * Applies server tag changes to a guild's profile (not saved). `unrestricted` skips the tag length/character rules. Returns whether anything tag-related was in the
 * request, in which case the caller saves the guild and then calls syncTagAdopters.
 */
export function applyGuildTag(guild: Guild, changes: GuildTagChanges, { unrestricted = false }: { unrestricted?: boolean } = {}) {
    const profile = { ...(guild.profile ?? {}) };
    if (changes.tag !== undefined) {
        // instance staff may set any tag (unrestricted); everyone else gets discord's 2-4 letters or numbers
        if (changes.tag !== null && !unrestricted && !/^[\p{L}\p{N}]{2,4}$/u.test(changes.tag)) throw new HTTPError("Tag must be 2 to 4 letters or numbers", 400);
        profile.tag = changes.tag;
    }
    if (changes.badge !== undefined) profile.badge = changes.badge as typeof profile.badge;
    // "" and null both mean the badge's own colours; store null so clients never get an invalid colour back
    if (changes.badge_color_primary !== undefined) profile.badge_color_primary = (changes.badge_color_primary || null) as string;
    if (changes.badge_color_secondary !== undefined) profile.badge_color_secondary = (changes.badge_color_secondary || null) as string;
    // the hash is what badge image urls are keyed on, so it changes whenever the badge would look different
    if (changes.badge !== undefined || changes.badge_color_primary !== undefined || changes.badge_color_secondary !== undefined)
        profile.badge_hash = crypto.createHash("md5").update(`${profile.badge}:${profile.badge_color_primary}:${profile.badge_color_secondary}`).digest("hex");
    guild.profile = profile;
    return Object.values(changes).some((v) => v !== undefined);
}

// everyone wearing this guild's tag gets the new tag and badge (or loses it if the tag was removed)
export async function syncTagAdopters(guild: Guild) {
    const profile = guild.profile ?? {};
    const adopters = await User.find({ where: { primary_guild: Raw((alias) => `${alias} ->> 'identity_guild_id' = :guild_id`, { guild_id: guild.id }) } });
    for (const user of adopters) {
        user.primary_guild = profile.tag
            ? { identity_guild_id: guild.id, identity_enabled: user.primary_guild?.identity_enabled ?? true, tag: profile.tag, badge: profile.badge_hash ?? null }
            : { identity_guild_id: guild.id, identity_enabled: false, tag: null, badge: null };
        await user.save();
    }
}
