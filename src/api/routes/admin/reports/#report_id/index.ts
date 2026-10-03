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
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Channel, Message, Report } from "@spacebar/database";
import { emitEvent, MessageDeleteEvent } from "@spacebar/util";
import { AdminReportUpdateSchema } from "@spacebar/schemas";
import { describeReports } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const findReport = (req: Request) => Report.findOneOrFail({ where: { id: req.params.report_id as string } });

router.get(
    "/",
    route({ right: "MANAGE_USERS", spacebarOnly: true, description: "A single report with its reporter, target and snapshot" }),
    async (req: Request, res: Response) => {
        const [report] = await describeReports([await findReport(req)]);
        res.json(report);
    },
);

router.patch(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        requestBody: "AdminReportUpdateSchema",
        description: "Resolve, dismiss or reopen a report, optionally deleting the reported message",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminReportUpdateSchema;
        const report = await findReport(req);

        if (body.delete_message) {
            if (!req.rights.has("MANAGE_MESSAGES")) throw new HTTPError("Deleting the reported message needs the MANAGE_MESSAGES right", 403);
            if (!report.message_id || !report.channel_id) throw new HTTPError("This report isn't about a message", 400);
            const message = await Message.findOne({ where: { id: report.message_id, channel_id: report.channel_id }, select: { id: true } });
            if (message) {
                const channel = await Channel.findOne({ where: { id: report.channel_id }, select: { id: true, guild_id: true } });
                await Message.delete({ id: message.id, channel_id: report.channel_id });
                await emitEvent({
                    event: "MESSAGE_DELETE",
                    channel_id: report.channel_id,
                    data: { id: message.id, channel_id: report.channel_id, guild_id: channel?.guild_id },
                } satisfies MessageDeleteEvent);
                console.log(`[Admin] User ${req.user_id} deleted message ${message.id} from report ${report.id}`);
            }
        }

        if (body.resolution_note !== undefined) report.resolution_note = body.resolution_note?.trim() || null;
        if (body.status !== undefined && body.status !== report.status) {
            report.status = body.status;
            report.resolved_by = body.status === "open" ? null : req.user_id;
            report.resolved_at = body.status === "open" ? null : new Date();
        }
        await report.save();

        const [described] = await describeReports([report]);
        res.json(described);
    },
);

export default router;
