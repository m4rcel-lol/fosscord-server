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
import multer from "multer";
import { route } from "@spacebar/api/middlewares";
import { InteractionCallbacksSchema } from "@spacebar/schemas";
import { ApiError, Config, DiscordApiErrors, pendingInteractions } from "@spacebar/util";
import { processInteractionCallback } from "@spacebar/api/util/handlers/Interaction";

const router = Router({ mergeParams: true });

const upload = multer({ limits: { fileSize: Config.get().limits.message.maxAttachmentSize, fields: 10 }, storage: multer.memoryStorage() });

router.post(
    "/",
    upload.any(),
    (req, _res, next) => {
        if (req.body.payload_json) req.body = JSON.parse(req.body.payload_json);
        next();
    },
    route({
        stripNulls: true,
        requestBody: "InteractionCallbacksSchema",
        authentication: "never",
        query: {
            with_response: { type: "boolean", required: false, description: "Whether to return the interaction callback response" },
        },
    }),
    async (req: Request, res: Response) => {
        const interaction = pendingInteractions.get(req.params.interaction_id as string);
        if (!interaction || interaction.token !== req.params.interaction_token) throw DiscordApiErrors.UNKNOWN_INTERACTION;
        if (interaction.acknowledged) throw new ApiError("Interaction has already been acknowledged.", 40060, 400);
        const response = await processInteractionCallback(interaction, req.body as InteractionCallbacksSchema, (req.files as Express.Multer.File[]) ?? []);
        if (req.query.with_response !== "true") return res.sendStatus(204);
        return res.json(response);
    },
);

export default router;
