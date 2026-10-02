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
import { ConnectedAccount } from "@spacebar/database";
import { ConnectedAccountDTO } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ oauth2: ["connections"] }), async (req: Request, res: Response) => {
    const connections = await ConnectedAccount.find({
        where: {
            user_id: req.user_id,
        },
        select: {
            external_id: true,
            type: true,
            name: true,
            verified: true,
            visibility: true,
            show_activity: true,
            revoked: true,
            token_data: true,
            friend_sync: true,
            integrations: true,
        },
    });

    res.json(
        connections.map((x) => {
            const dto = new ConnectedAccountDTO(x, !req.oauth2);
            if (!req.oauth2) return dto;
            return {
                id: dto.id,
                name: dto.name,
                type: dto.type,
                revoked: dto.revoked,
                integrations: dto.integrations ?? [],
                verified: dto.verified,
                friend_sync: dto.friend_sync,
                show_activity: dto.show_activity,
                two_way_link: dto.two_way_link,
                visibility: dto.visibility,
            };
        }),
    );
});

export default router;
