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
import { route } from "@spacebar/api/middlewares";
import { Guild, Member } from "@spacebar/database";
import { emitEvent, GuildUpdateEvent } from "@spacebar/util";
import { GuildOnboarding } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const defaults = (guild_id: string, onboarding?: Partial<GuildOnboarding> | null): GuildOnboarding => ({
    guild_id,
    prompts: onboarding?.prompts ?? [],
    default_channel_ids: onboarding?.default_channel_ids ?? [],
    enabled: onboarding?.enabled ?? false,
    mode: onboarding?.mode ?? 0,
    below_requirements: false,
});

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const [guild, member] = await Promise.all([
        Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, onboarding: true } }),
        Member.findOne({ where: { id: req.user_id, guild_id }, select: { id: true, onboarding_responses: true } }),
    ]);
    res.json({
        ...defaults(guild_id, guild.onboarding),
        responses: member?.onboarding_responses?.onboarding_responses ?? [],
        onboarding_prompts_seen: member?.onboarding_responses?.onboarding_prompts_seen ?? {},
        onboarding_responses_seen: member?.onboarding_responses?.onboarding_responses_seen ?? {},
    });
});

router.put("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
    const body = req.body as Partial<GuildOnboarding>;
    const onboarding = defaults(guild_id, { ...defaults(guild_id, guild.onboarding), ...body });
    onboarding.prompts = onboarding.prompts.map((prompt) => ({
        ...prompt,
        options: prompt.options.map((option) => ({
            ...option,
            emoji: option.emoji ?? (option.emoji_id || option.emoji_name ? { id: option.emoji_id, name: option.emoji_name, animated: option.emoji_animated } : null),
        })),
    }));
    guild.onboarding = onboarding;

    const features = new Set(guild.features);
    if (onboarding.enabled) features.add("GUILD_ONBOARDING").add("GUILD_ONBOARDING_EVER_ENABLED");
    else features.delete("GUILD_ONBOARDING");
    if (onboarding.prompts.length) features.add("GUILD_ONBOARDING_HAS_PROMPTS");
    else features.delete("GUILD_ONBOARDING_HAS_PROMPTS");
    const featuresChanged = features.size !== guild.features.length || [...features].some((f) => !guild.features.includes(f));
    guild.features = [...features];
    await guild.save();

    if (featuresChanged) await emitEvent({ event: "GUILD_UPDATE", data: guild.toJSON() as unknown as GuildUpdateEvent["data"], guild_id } satisfies GuildUpdateEvent);

    res.json(onboarding);
});

export default router;
