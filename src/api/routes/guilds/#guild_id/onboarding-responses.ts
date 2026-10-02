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
import { Guild, Member, Role } from "@spacebar/database";
import { emitEvent, GuildMemberUpdateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const COMPLETED_ONBOARDING = 1 << 1;
const STARTED_ONBOARDING = 1 << 3;

const handler = async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const body = req.body as { onboarding_responses?: string[]; onboarding_prompts_seen?: Record<string, number>; onboarding_responses_seen?: Record<string, number> };
    const [guild, member] = await Promise.all([
        Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, onboarding: true } }),
        Member.findOneOrFail({ where: { id: req.user_id, guild_id }, relations: { roles: true, user: true } }),
    ]);

    const responses = {
        onboarding_responses: body.onboarding_responses ?? [],
        onboarding_prompts_seen: body.onboarding_prompts_seen ?? {},
        onboarding_responses_seen: body.onboarding_responses_seen ?? {},
    };
    const options = (guild.onboarding?.prompts ?? []).flatMap((prompt) => prompt.options);
    const selected = options.filter((option) => responses.onboarding_responses.includes(option.id));
    const onboardingRoles = new Set(options.flatMap((option) => option.role_ids ?? []));
    const wantedRoles = new Set(selected.flatMap((option) => option.role_ids ?? []));
    const existingRoles = await Role.find({ where: [...wantedRoles].map((id) => ({ id, guild_id })), select: { id: true } });

    member.roles = [...member.roles.filter((role) => !onboardingRoles.has(role.id)), ...existingRoles];
    member.onboarding_responses = responses;
    member.flags = ((member.flags ?? 0) | COMPLETED_ONBOARDING | STARTED_ONBOARDING) >>> 0;
    await member.save();

    await emitEvent({
        event: "GUILD_MEMBER_UPDATE",
        guild_id,
        data: { ...member.toPublicMember(), guild_id, user: member.user.toPublicUser(), roles: member.roles.map((role) => role.id).filter((id) => id !== guild_id) },
    } satisfies GuildMemberUpdateEvent);

    res.json({ guild_id, user_id: req.user_id, ...responses });
};

router.post("/", route({}), handler);
router.put("/", route({}), handler);

export default router;
