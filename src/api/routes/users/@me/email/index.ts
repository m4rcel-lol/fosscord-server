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
import { EmailChange } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { Config, Email } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.put("/", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, username: true, email: true } });
    const code = EmailChange.createCode(req.user_id);

    if (!Email.transporter || !user.email) {
        console.log(`[Email] no mail provider configured, email change code for ${user.username} (${user.id}) is ${code}`);
        return res.sendStatus(204);
    }

    const text = `Your ${Config.get().general.instanceName} verification code is ${code}. It expires in 10 minutes.`;
    await Email.transporter.sendMail({
        from: Config.get().email.senderAddress || Config.get().general.correspondenceEmail || "noreply@localhost",
        to: user.email,
        subject: `Your verification code is ${code}`,
        text,
        html: `<p>${text}</p>`,
    });
    res.sendStatus(204);
});

export default router;
