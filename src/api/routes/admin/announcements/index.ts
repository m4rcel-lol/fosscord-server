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

import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Announcement, User } from "@spacebar/database";
import { Config } from "@spacebar/util";
import { AdminAnnouncementCreateSchema, EmbedType } from "@spacebar/schemas";
import { getSystemAccount, sendSystemDM } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// people with admin panel access: operators, user managers and server managers
const STAFF_RIGHTS_MASK = 1 + 4 + 128;

async function audienceIds(audience: AdminAnnouncementCreateSchema["audience"]) {
    const query = User.createQueryBuilder("u").select(["u.id"]).where("u.deleted = false AND u.bot = false AND u.system = false");
    if (audience === "staff") query.andWhere("(u.rights & :mask) != 0", { mask: STAFF_RIGHTS_MASK });
    return (await query.getMany()).map((u) => u.id);
}

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Recent staff announcements" }), async (req: Request, res: Response) => {
    const official = await getSystemAccount("official");
    const announcements = await Announcement.find({ order: { created_at: "DESC" }, take: 50 });
    res.json({ official: { id: official.id, username: official.username, global_name: official.global_name }, announcements });
});

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminAnnouncementCreateSchema", description: "DM an announcement from the official account" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminAnnouncementCreateSchema;
        const recipients = await audienceIds(body.audience);
        const announcement = await Announcement.create({
            title: body.title.trim(),
            body: body.body.trim(),
            audience: body.audience,
            sent_by: req.user_id,
            recipient_count: recipients.length,
        }).save();

        const embed = {
            type: EmbedType.rich,
            title: announcement.title,
            description: announcement.body,
            color: 0x5865f2,
            footer: { text: `${Config.get().general.instanceName} staff` },
            timestamp: announcement.created_at,
        };
        // delivered in the background so big instances don't time the request out
        void (async () => {
            for (const id of recipients) await sendSystemDM("official", id, { embeds: [embed] }).catch((e) => console.error(`[Announcement] couldn't reach ${id}`, e));
            console.log(`[Announcement] ${announcement.id} delivered to ${recipients.length} users`);
        })();

        res.status(201).json(announcement);
    },
);

export default router;
