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
import { Announcement, AnnouncementMessage, Message } from "@spacebar/database";
import { Snowflake } from "@spacebar/util";
import { getSystemAccount } from "@spacebar/api/util";
import { deleteAnnouncementMessages } from "./index";

const router = Router({ mergeParams: true });
// announcements sent before their dms were recorded: the official account's messages with the same text (plain, or the
// embed they used to be), sent within a day of it
async function untrackedMessages(announcement: Announcement) {
    const official = await getSystemAccount("official");
    const since = Number(announcement.created_at) - 60_000;
    const range = (ms: number) => ((BigInt(ms) - BigInt(Snowflake.EPOCH)) << 22n).toString();
    return Message.createQueryBuilder("m")
        .select(["m.id", "m.channel_id"])
        .where("m.author_id = :author", { author: official.id })
        .andWhere("m.id BETWEEN :from AND :to", { from: range(since), to: range(since + 24 * 60 * 60_000) })
        .andWhere(`(m.content = :body OR (m.embeds -> 0 ->> 'description' = :body AND COALESCE(m.embeds -> 0 ->> 'title', '') = :title))`, {
            body: announcement.body,
            title: announcement.title ?? "",
        })
        .getMany();
}

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Delete an announcement and take back every dm it was sent as, with their attachments",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const announcement = await Announcement.findOneOrFail({ where: { id: req.params.announcement_id as string } });
        const tracked = await AnnouncementMessage.find({ where: { announcement_id: announcement.id } });
        const messages = tracked.length ? tracked.map((m) => ({ id: m.message_id, channel_id: m.channel_id })) : await untrackedMessages(announcement);

        // removing the announcement first stops a delivery that's still running
        await Announcement.delete({ id: announcement.id });
        void deleteAnnouncementMessages(messages)
            .then(() => console.log(`[Announcement] User ${req.user_id} deleted announcement ${announcement.id} and its ${messages.length} messages`))
            .catch((e) => console.error(`[Announcement] couldn't delete the messages of ${announcement.id}`, e));

        res.sendStatus(204);
    },
);

export default router;
