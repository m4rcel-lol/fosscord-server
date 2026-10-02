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
import { Guild } from "@spacebar/database";
import { emitEvent, GuildUpdateEvent } from "@spacebar/util";
import { GuildMemberVerificationModifySchema } from "@spacebar/schemas";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

        if (!guild.member_verification)
            return res.status(404).json({
                message: "Unknown Guild Member Verification Form",
                code: 10068,
            });

        res.json({
            ...guild.member_verification,
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

    guild.member_verification = {
        version: new Date().toISOString(),
        form_fields: body.form_fields ?? guild.member_verification?.form_fields ?? [],
        description: body.description !== undefined ? body.description : (guild.member_verification?.description ?? null),
    };

    if (body.enabled !== undefined) {
        guild.features = guild.features.filter((feature) => feature !== "MEMBER_VERIFICATION_GATE_ENABLED");
        if (body.enabled) guild.features.push("MEMBER_VERIFICATION_GATE_ENABLED");
    }
    await guild.save();

    if (body.enabled !== undefined) await emitEvent({ event: "GUILD_UPDATE", data: guild.toJSON() as unknown as GuildUpdateEvent["data"], guild_id } satisfies GuildUpdateEvent);

    res.json(guild.member_verification);
});

export default router;
