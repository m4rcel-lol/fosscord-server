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

import fs from "node:fs/promises";
import path from "node:path";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config, PUBLIC_ASSETS_FOLDER, instanceName } from "@spacebar/util";

const PAGES = {
    terms: { title: "Terms of Service", url: () => Config.get().general.tosPage },
    privacy: { title: "Privacy Policy", url: () => Config.get().general.privacyPage || Config.get().general.tosPage },
    guidelines: { title: "Community Guidelines", url: () => Config.get().general.guidelinesPage || Config.get().general.tosPage },
};

const escapeHtml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

const isWebUrl = (url?: string | null): url is string => !!url && /^https?:\/\//i.test(url.trim());

export const legalPageRouter = (kind: keyof typeof PAGES) => {
    const router = Router({ mergeParams: true });
    router.get(
        "/",
        route({
            spacebarOnly: true,
            authentication: "never",
        }),
        async (req: Request, res: Response) => {
            const { title, url } = PAGES[kind];
            const target = url();
            res.set("Cache-Control", "no-cache");
            if (isWebUrl(target)) return res.redirect(302, target.trim());
            const { correspondenceEmail, frontPage } = Config.get().general;
            const contact = correspondenceEmail
                ? `<p>Questions about how this instance is run can be sent to <a href="mailto:${escapeHtml(correspondenceEmail)}">${escapeHtml(correspondenceEmail)}</a>.</p>`
                : "";
            const page = await fs.readFile(path.join(PUBLIC_ASSETS_FOLDER, "legal.html"), "utf8");
            res.type("html").send(
                page
                    .replaceAll("__INSTANCE_NAME__", escapeHtml(instanceName()))
                    .replaceAll("__TITLE__", escapeHtml(title))
                    .replaceAll("__HOME__", escapeHtml(isWebUrl(frontPage) ? frontPage.trim() : "/"))
                    .replace("__CONTACT__", contact),
            );
        },
    );
    return router;
};
