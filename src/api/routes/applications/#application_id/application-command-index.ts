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
import { Application } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const application = await Application.findOne({ where: { id: req.params.application_id as string } });
    if (!application) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    res.json(await buildCommandIndex([application.id], {}));
});

export default router;
