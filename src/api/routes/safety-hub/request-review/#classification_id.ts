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
import { UserViolation } from "@spacebar/database";
import { requestAppeal } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// a user appealing one of their violations. The client sends PUT { signal, user_input }: signal is the reason they
// picked (0 didn't break the rules, 1 too strict, 2 disagree with the penalty, 3 something else)
const appeal = async (req: Request, res: Response) => {
    const violation = await UserViolation.findOne({ where: { id: req.params.classification_id as string, user_id: req.user_id } });
    if (!violation) throw new HTTPError("Unknown violation", 404);
    if (violation.appeal_status != null) throw new HTTPError("This violation has already been appealed", 400);

    const signal = Number.isInteger(req.body?.signal) && req.body.signal >= 0 && req.body.signal <= 3 ? req.body.signal : null;
    const userInput = typeof req.body?.user_input === "string" ? req.body.user_input : null;
    await requestAppeal(violation, signal, userInput);
    res.sendStatus(204);
};

const options = route({ responses: { 204: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } });
router.put("/", options, appeal);
router.post("/", options, appeal);

export default router;
