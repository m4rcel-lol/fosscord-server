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
import { Stream, StreamPreviews } from "@spacebar/database";
import { HTTPError } from "lambert-server";

const router: Router = Router({ mergeParams: true });
const MAX_PREVIEW_LENGTH = 2 * 1024 * 1024;

const ownerOf = (key: string) => key.split(":").at(-1);

router.get("/", route({ responses: { 200: {}, 404: {} } }), async (req: Request, res: Response) => {
    const url = StreamPreviews.get(req.params.stream_key as string);
    if (!url) throw new HTTPError("Unknown stream preview", 404);
    res.json({ url });
});

router.post("/", route({ responses: { 204: {}, 400: {}, 403: {} } }), async (req: Request, res: Response) => {
    const key = req.params.stream_key as string;
    if (ownerOf(key) !== req.user_id) throw new HTTPError("Only the stream owner can upload a preview", 403);
    const thumbnail = req.body?.thumbnail;
    if (typeof thumbnail !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(thumbnail) || thumbnail.length > MAX_PREVIEW_LENGTH) throw new HTTPError("Invalid thumbnail", 400);
    if (!(await Stream.exists({ where: { owner_id: req.user_id } }))) throw new HTTPError("Unknown stream", 404);
    StreamPreviews.set(key, thumbnail);
    res.sendStatus(204);
});

export default router;
