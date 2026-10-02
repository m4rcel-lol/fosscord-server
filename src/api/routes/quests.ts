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

const router = Router({ mergeParams: true });

router.get("/@me", route({}), (req: Request, res: Response) => {
    res.json({ quests: [], excluded_quests: [], quest_enrollment_blocked_until: null, quest_access_suspended_until: null });
});

router.get("/@me/claimed", route({}), (req: Request, res: Response) => {
    res.json({ quests: [] });
});

router.get("/decision", route({}), (req: Request, res: Response) => {
    res.json({ request_id: null, quest: null, creative: null, ad_identifiers: null, ad_context: null, response_ttl_seconds: 86400 });
});

router.get("/get-decisions", route({}), (req: Request, res: Response) => {
    res.json({ request_id: null, decisions: [] });
});

export default router;
