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
import { ILike } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Application, ApplicationTester, ApplicationTesterState, Relationship, User } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { ApplicationTesterAddSchema, RelationshipType } from "@spacebar/schemas";

const router = Router({ mergeParams: true });
const MAX_TESTERS = 50;

const ownedApplication = async (req: Request) => {
    const app = await Application.findOne({ where: { id: req.params.application_id as string }, select: { id: true, owner_id: true } });
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (app.owner_id !== req.user_id) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
    return app;
};

const serialize = (tester: ApplicationTester) => ({ user: tester.user.toPublicUser(), state: tester.state });

router.get("/", route({ responses: { 200: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const app = await ownedApplication(req);
    const testers = await ApplicationTester.find({ where: { application_id: app.id }, relations: { user: true }, order: { created_at: "ASC" } });
    res.json(testers.map(serialize));
});

router.post(
    "/",
    route({
        requestBody: "ApplicationTesterAddSchema",
        responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as ApplicationTesterAddSchema;
        const app = await ownedApplication(req);
        const username = body.username.trim().replace(/^@/, "");
        const discriminator = body.discriminator && Number(body.discriminator) !== 0 ? String(body.discriminator).padStart(4, "0") : "0";
        const user = await User.findOne({
            where: discriminator === "0" ? { discriminator, username: ILike(username.replace(/[\\%_]/g, "\\$&")) } : { discriminator, username },
        });
        if (!user || user.bot) throw DiscordApiErrors.UNKNOWN_USER;
        if (user.id === req.user_id) throw new HTTPError("You already have access to your own application.", 400);
        const friends = await Relationship.exists({ where: { from_id: req.user_id, to_id: user.id, type: RelationshipType.FRIEND } });
        if (!friends) throw new HTTPError("You can only add friends as testers.", 400);
        if (!(await ApplicationTester.exists({ where: { application_id: app.id, user_id: user.id } }))) {
            if ((await ApplicationTester.count({ where: { application_id: app.id } })) >= MAX_TESTERS)
                throw new HTTPError(`Applications can have up to ${MAX_TESTERS} testers.`, 400);
            await ApplicationTester.create({ application_id: app.id, user_id: user.id, state: ApplicationTesterState.ACCEPTED }).save();
        }
        const tester = await ApplicationTester.findOneOrFail({ where: { application_id: app.id, user_id: user.id }, relations: { user: true } });
        res.json(serialize(tester));
    },
);

router.delete("/:user_id", route({ responses: { 204: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const app = await ownedApplication(req);
    await ApplicationTester.delete({ application_id: app.id, user_id: req.params.user_id as string });
    res.sendStatus(204);
});

export default router;
