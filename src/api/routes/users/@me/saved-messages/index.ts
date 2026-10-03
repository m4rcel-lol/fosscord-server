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
import { Message, SavedMessage } from "@spacebar/database";
import { canReadMessage, savedMessageRelations, savedMessageResult } from "@spacebar/api/util/handlers/SavedMessages";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const saved = await SavedMessage.find({ where: { user_id: req.user_id }, order: { saved_at: "DESC" } });
    const messages = saved.length ? await Message.find({ where: { id: In(saved.map((s) => s.message_id)) }, relations: savedMessageRelations }) : [];
    const byId = new Map(messages.map((m) => [m.id, m]));
    const results = [];
    for (const entry of saved) {
        const message = byId.get(entry.message_id) ?? null;
        results.push(savedMessageResult(entry, message && (await canReadMessage(req.user_id, message)) ? message : null, req.user_id));
    }
    res.json({ results });
});

export default router;
