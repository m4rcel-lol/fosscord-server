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

import { route } from "@spacebar/api/middlewares";
import { Guild, Invite, Member } from "@spacebar/database";
import { GuildMemberVerificationModifySchema } from "@spacebar/schemas";
import { Request, Response, Router } from "express";
import { bulkActionJoinRequests, isApplyGuild, needsManualApproval, startJoinRequest } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {},
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

        const invite_code = typeof req.query.invite_code === "string" ? req.query.invite_code : null;
        if (invite_code && isApplyGuild(guild.features) && !(await Member.exists({ where: { id: req.user_id, guild_id } }))) {
            const invite = await Invite.findOne({ where: { code: invite_code, guild_id } });
            if (invite && !invite.isExpired()) await startJoinRequest(guild_id, req.user_id);
        }

        res.json({
            ...(guild.member_verification ?? { version: null, form_fields: [], description: null }),
            ...(req.query.with_guild === "true" && {
                guild: { ...guild.toInviteGuild(), approximate_member_count: guild.member_count, approximate_presence_count: guild.presence_count ?? 0 },
            }),
        });
    },
);

router.patch("/", route({ requestBody: "GuildMemberVerificationModifySchema", permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const body = req.body as GuildMemberVerificationModifySchema;
    const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
    const wasApply = isApplyGuild(guild.features);
    const featuresBefore = guild.features.join();

    guild.member_verification = {
        version: new Date().toISOString(),
        form_fields: body.form_fields ?? guild.member_verification?.form_fields ?? [],
        description: body.description !== undefined ? body.description : (guild.member_verification?.description ?? null),
    };

    if (body.enabled !== undefined) {
        guild.features = guild.features.filter((feature) => feature !== "MEMBER_VERIFICATION_GATE_ENABLED");
        if (body.enabled) guild.features.push("MEMBER_VERIFICATION_GATE_ENABLED");
    }
    if (body.form_fields) {
        guild.features = guild.features.filter((feature) => feature !== "MEMBER_VERIFICATION_MANUAL_APPROVAL");
        if (needsManualApproval(guild.member_verification.form_fields)) guild.features.push("MEMBER_VERIFICATION_MANUAL_APPROVAL");
    }
    await guild.save();

    if (guild.features.join() !== featuresBefore) await Guild.emitUpdate(guild_id);
    if (wasApply && !isApplyGuild(guild.features)) await bulkActionJoinRequests(guild_id, req.user_id, body.bulk_action === "REJECTED" ? "REJECTED" : "APPROVED");

    res.json(guild.member_verification);
});

export default router;
