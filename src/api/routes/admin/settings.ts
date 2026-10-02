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
import { Config } from "@spacebar/util";
import { AdminSettingsUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const pickSettings = () => {
    const { general, register } = Config.get();
    return {
        general: {
            instanceName: general.instanceName,
            instanceDescription: general.instanceDescription,
            image: general.image,
            frontPage: general.frontPage,
            tosPage: general.tosPage,
            correspondenceEmail: general.correspondenceEmail,
            correspondenceUserID: general.correspondenceUserID,
        },
        register: {
            disabled: register.disabled,
            allowNewRegistration: register.allowNewRegistration,
            requireInvite: register.requireInvite,
            requireCaptcha: register.requireCaptcha,
            allowMultipleAccounts: register.allowMultipleAccounts,
        },
    };
};

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Get the instance settings editable from the admin dashboard",
    }),
    (req: Request, res: Response) => {
        res.json(pickSettings());
    },
);

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminSettingsUpdateSchema",
        description: "Update instance information and registration settings",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSettingsUpdateSchema;
        // empty strings from the dashboard's text inputs mean "unset"
        const general = Object.fromEntries(Object.entries(body.general ?? {}).map(([k, v]) => [k, typeof v === "string" && k !== "instanceName" ? v.trim() || null : v]));
        if (typeof general.instanceName === "string" && !general.instanceName.trim()) delete general.instanceName;

        await Config.set({ general: general as object, register: body.register ?? {} } as Parameters<typeof Config.set>[0]);
        res.json(pickSettings());
    },
);

export default router;
