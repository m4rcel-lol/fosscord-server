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

import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { profileMetadata, resolveProfileCollectibles } from "@spacebar/api/util";
import { Application, Badge, Member, Relationship, User } from "@spacebar/database";
import { Config, emitEvent, FieldErrors, handleFile, UserUpdateEvent } from "@spacebar/util";
import { PartialConnectedAccountResponse, PrivateUserProjection, PublicUserProjection, RelationshipType, UserProfileModifySchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const PREMIUM_BADGE_ICON = "2ba85e8026a8614b640c2837bcdfe21b";

router.get("/", route({ responses: { 200: { body: "UserProfileResponse" } } }), async (req: Request, res: Response) => {
    if (req.params.user_id === "@me") req.params.user_id = req.user_id;

    const { guild_id, with_mutual_guilds, with_mutual_friends, with_mutual_friends_count } = req.query as Record<string, string | undefined>;
    const { user_id } = req.params as { [key: string]: string };

    const user = await User.findOneOrFail({
        where: { id: user_id },
        relations: { connected_accounts: true, avatar_decoration: true },
        select: {
            connected_accounts: {
                id: true,
                type: true,
                name: true,
                verified: true,
                metadata_: true,
                metadata_visibility: true,
                visibility: true,
            },
        },
    });

    const memberships = await Member.find({ where: { id: user_id }, select: { guild_id: true, nick: true, premium_since: true } });
    const premium_guild_since = memberships
        .map((x) => x.premium_since)
        .filter((x) => x != null)
        .sort((a, b) => Number(a) - Number(b))[0];

    let mutual_guilds: { id: string; nick: string | null }[] | undefined;
    if (with_mutual_guilds === "true") {
        const own = new Set((await Member.find({ where: { id: req.user_id }, select: { guild_id: true } })).map((x) => x.guild_id));
        mutual_guilds = user_id === req.user_id ? [] : memberships.filter((x) => own.has(x.guild_id)).map((x) => ({ id: x.guild_id, nick: x.nick ?? null }));
    }

    let mutual_friends;
    let mutual_friends_count;
    if (with_mutual_friends === "true" || with_mutual_friends_count === "true") {
        const [mine, theirs] = await Promise.all(
            [req.user_id, user_id].map((from_id) => Relationship.find({ where: { from_id, type: RelationshipType.FRIEND }, select: { to_id: true } })),
        );
        const theirIds = new Set(theirs.map((x) => x.to_id));
        const mutualIds = user_id === req.user_id ? [] : mine.map((x) => x.to_id).filter((x) => theirIds.has(x));
        mutual_friends_count = mutualIds.length;
        if (with_mutual_friends === "true")
            mutual_friends = mutualIds.length
                ? (
                      await User.find({
                          where: { id: In(mutualIds) },
                          select: Object.fromEntries(PublicUserProjection.map((i) => [i, true])),
                      })
                  ).map((u) => u.toPartialUser())
                : [];
    }

    const guild_member = guild_id
        ? await Member.findOne({
              where: { id: user_id, guild_id },
              relations: { roles: true },
          })
        : null;

    const badges = [];
    if (user.premium_type > 0 && user.premium_since && !user.hide_premium_badge)
        badges.push({
            id: "premium",
            description: `Subscriber since ${new Date(user.premium_since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
            icon: PREMIUM_BADGE_ICON,
            link: "https://discord.com/settings/premium",
        });
    if (user.badge_ids?.length) badges.push(...(await Badge.find({ where: { id: In(user.badge_ids) } })));

    const connected_accounts: PartialConnectedAccountResponse[] = user.connected_accounts
        .filter((x) => x.visibility != 0)
        .map((x) => ({
            id: x.id,
            type: x.type,
            name: x.name,
            verified: x.verified ?? false,
            ...(x.metadata_visibility != 0 && x.metadata_ ? { metadata: x.metadata_ } : {}),
        }));

    const application = user.bot ? await Application.findOne({ where: { bot: { id: user_id } }, select: { id: true, flags: true } }) : null;

    res.json({
        user: { ...user.toPartialUser(), bio: user.bio ?? "" },
        connected_accounts,
        premium_since: user.premium_type > 0 ? user.premium_since : null,
        premium_type: user.premium_type,
        premium_guild_since: premium_guild_since ? new Date(Number(premium_guild_since)) : null,
        profile_themes_experiment_bucket: 4,
        user_profile: profileMetadata(user),
        badges,
        guild_badges: [],
        widgets: [],
        legacy_username: null,
        ...(application ? { application: { id: application.id, flags: application.flags, verified: false } } : {}),
        ...(mutual_guilds ? { mutual_guilds } : {}),
        ...(mutual_friends ? { mutual_friends } : {}),
        ...(mutual_friends_count !== undefined ? { mutual_friends_count } : {}),
        ...(guild_member
            ? {
                  guild_member: { ...guild_member.toPublicMember(), roles: guild_member.roles.filter((x) => x.id !== guild_id).map((x) => x.id), user: user.toPartialUser() },
                  guild_member_profile: profileMetadata(guild_member),
              }
            : {}),
    });
});

router.patch("/", route({ requestBody: "UserProfileModifySchema" }), async (req: Request, res: Response) => {
    const body = req.body as UserProfileModifySchema;

    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: Object.fromEntries([...PrivateUserProjection, "profile_collectibles"].map((i) => [i, true])),
    });

    const { maxBio, maxPronouns } = Config.get().limits.user;
    if (body.bio && body.bio.length > maxBio)
        throw FieldErrors({
            bio: {
                code: "BIO_INVALID",
                message: `Bio must be less than ${maxBio} in length`,
            },
        });
    if (body.pronouns && body.pronouns.length > maxPronouns)
        throw FieldErrors({
            pronouns: {
                code: "PRONOUNS_INVALID",
                message: `Pronouns must be less than ${maxPronouns} in length`,
            },
        });

    if (body.bio !== undefined) user.bio = body.bio ?? "";
    if (body.pronouns !== undefined) Object.assign(user, { pronouns: body.pronouns || null });
    if (body.accent_color !== undefined) Object.assign(user, { accent_color: body.accent_color });
    if (body.theme_colors !== undefined) Object.assign(user, { theme_colors: body.theme_colors });
    if (body.banner !== undefined) Object.assign(user, { banner: body.banner ? await handleFile(`/banners/${req.user_id}`, body.banner) : null });

    if (body.collectibles_sku_ids !== undefined || body.profile_effect_id !== undefined)
        user.profile_collectibles = await resolveProfileCollectibles(user.profile_collectibles, body.collectibles_sku_ids, body.profile_effect_id);

    await user.save();

    await emitEvent({
        event: "USER_UPDATE",
        user_id: req.user_id,
        data: user,
    } satisfies UserUpdateEvent);

    res.json(profileMetadata(user));
});

export default router;
