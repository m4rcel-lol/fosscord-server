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
import multer from "multer";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { In } from "typeorm";
import { Announcement, AnnouncementMessage, Attachment, Message, User } from "@spacebar/database";
import { Config, deleteFile, emitEvent, MessageDeleteEvent } from "@spacebar/util";
import { AdminAnnouncementCreateSchema } from "@spacebar/schemas";
import { getSystemAccount, sendSystemDM } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// people with admin panel access: operators, user managers and server managers
const STAFF_RIGHTS_MASK = 1 + 4 + 128;

const CHUNK = 500;

/** Deletes announcement dms for everyone, with their attachment files. */
export async function deleteAnnouncementMessages(messages: Pick<Message, "id" | "channel_id">[]) {
    for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk = messages.slice(i, i + CHUNK);
        const ids = chunk.map((m) => m.id);
        // each dm has its own copy of the files; deleting the rows below doesn't remove them from storage
        const attachments = await Attachment.find({ where: { message_id: In(ids) } });
        for (const attachment of attachments)
            await deleteFile(new URL(attachment.toJSON().url).pathname).catch((e) => console.error(`[Announcement] couldn't delete file of attachment ${attachment.id}`, e));
        await Message.delete({ id: In(ids) });
        for (const message of chunk)
            await emitEvent({ event: "MESSAGE_DELETE", channel_id: message.channel_id!, data: { id: message.id, channel_id: message.channel_id! } } satisfies MessageDeleteEvent);
    }
}

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

const announcementUpload = multer({
    limits: {
        fileSize: Config.get().limits.message.maxAttachmentSize,
        fields: 10,
        files: Config.get().limits.message.maxAttachments,
    },
    storage: multer.memoryStorage(),
});

router.post(
    "/",
    // multipart with the fields in payload_json when there are attachments, like a regular message
    announcementUpload.any(),
    (req, res, next) => {
        if (req.body.payload_json) req.body = JSON.parse(req.body.payload_json);
        next();
    },
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminAnnouncementCreateSchema",
        description: "DM an announcement from the official account, as a plain message with any attached files",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminAnnouncementCreateSchema;
        const files = (req.files as Express.Multer.File[]) ?? [];
        const content = body.body.trim();
        const { maxCharacters } = Config.get().limits.message;
        if (content.length > maxCharacters) throw new HTTPError(`The message is ${content.length} characters, the limit for a message is ${maxCharacters}`, 400);

        const recipients = await audienceIds(body.audience);
        const announcement = await Announcement.create({
            body: content,
            audience: body.audience,
            sent_by: req.user_id,
            recipient_count: recipients.length,
        }).save();

        // delivered in the background so big instances don't time the request out. Every dm is recorded so deleting the
        // announcement can take them back, and deleting it midway stops the rest from going out
        void (async () => {
            let delivered = 0;
            for (const id of recipients) {
                if (!(await Announcement.exists({ where: { id: announcement.id } }))) {
                    console.log(`[Announcement] ${announcement.id} was deleted after reaching ${delivered} of ${recipients.length} users, stopping`);
                    return;
                }
                const message = await sendSystemDM("official", id, { content, files }).catch((e) => console.error(`[Announcement] couldn't reach ${id}`, e));
                if (!message) continue;
                delivered++;
                await AnnouncementMessage.insert({ message_id: message.id, channel_id: message.channel_id!, announcement_id: announcement.id }).catch(
                    // deleted while this one was on its way
                    () => deleteAnnouncementMessages([{ id: message.id, channel_id: message.channel_id }]),
                );
            }
            console.log(`[Announcement] ${announcement.id} delivered to ${delivered} of ${recipients.length} users`);
        })();

        res.status(201).json(announcement);
    },
);

export default router;
