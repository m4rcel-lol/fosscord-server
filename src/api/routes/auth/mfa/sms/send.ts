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
import { MfaInvalidTicket, PhoneVerification, ResponseError, readTicket, redactPhone, smsPhone } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "never", spacebarOnly: false }), async (req: Request, res: Response) => {
    const { ticket } = req.body as { ticket?: string };
    const decoded = readTicket(ticket, "login") ?? readTicket(ticket, "mfa");
    if (!decoded?.uid) throw MfaInvalidTicket();
    const phone = await smsPhone(decoded.uid);
    if (!phone) throw new ResponseError(400, { message: "SMS authentication is not enabled.", code: 60002 });
    PhoneVerification.send(phone, decoded.uid);
    res.json({ phone: redactPhone(phone) });
});

export default router;
