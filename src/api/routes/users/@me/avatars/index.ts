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
import { User } from "@spacebar/database";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { recent_avatars } = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, recent_avatars: true } });
    res.json({ avatars: recent_avatars ?? [] });
});

router.delete("/:avatar_id", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, recent_avatars: true } });
    await User.update({ id: req.user_id }, { recent_avatars: (user.recent_avatars ?? []).filter((x) => x.id !== req.params.avatar_id) });
    res.sendStatus(204);
});

export default router;
