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

import path from "node:path";
import { Router } from "express";
import { readTicket, signTicket } from "@spacebar/api/util/utility/mfa";

export const ACTIVITY_ASSETS = path.join(__dirname, "..", "..", "..", "assets", "activities");

const PROXY_TICKET_TTL = 12 * 3600;

export interface BuiltinActivity {
    key: string;
    name: string;
    description: string;
    tags: string[];
    shelfRank: number;
    icon: string;
    assets: { name: string; file: string }[];
    router: Router;
}

export type ActivityProxyTicket = {
    typ: "activity_proxy";
    uid: string;
    app: string;
    cid?: string;
};

export const signProxyTicket = (userId: string, applicationId: string, channelId?: string) =>
    signTicket({ typ: "activity_proxy", uid: userId, app: applicationId, ...(channelId && { cid: channelId }) }, PROXY_TICKET_TTL);

export const readProxyTicket = (ticket: unknown, applicationId: string) => {
    const decoded = readTicket<ActivityProxyTicket>(ticket, "activity_proxy");
    return decoded?.app === applicationId ? decoded : null;
};
