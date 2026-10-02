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
import { StageInstances } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { HTTPError } from "lambert-server";
import { stageModerator } from "./index";

const router: Router = Router({ mergeParams: true });

const instanceFor = (req: Request) => {
    const instance = StageInstances.get(req.params.channel_id as string);
    if (!instance) throw new HTTPError("Unknown Stage Instance", 404);
    return instance;
};

router.get("/", route({ responses: { 200: {}, 404: {} } }), async (req: Request, res: Response) => {
    await stageModerator(req.user_id, req.params.channel_id as string);
    res.json(instanceFor(req));
});

router.patch("/", route({ responses: { 200: {}, 400: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const { moderator } = await stageModerator(req.user_id, req.params.channel_id as string);
    if (!moderator) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("MANAGE_CHANNELS");
    instanceFor(req);
    const changes: { topic?: string; privacy_level?: number } = {};
    if (typeof req.body?.topic === "string" && req.body.topic.trim()) changes.topic = req.body.topic.trim().slice(0, 120);
    if (req.body?.privacy_level != null) changes.privacy_level = Number(req.body.privacy_level);
    res.json(await StageInstances.update(req.params.channel_id as string, changes));
});

router.delete("/", route({ responses: { 204: {}, 403: {}, 404: {} } }), async (req: Request, res: Response) => {
    const { moderator } = await stageModerator(req.user_id, req.params.channel_id as string);
    if (!moderator) throw DiscordApiErrors.MISSING_PERMISSIONS.withParams("MANAGE_CHANNELS");
    instanceFor(req);
    await StageInstances.delete(req.params.channel_id as string);
    res.sendStatus(204);
});

export default router;
