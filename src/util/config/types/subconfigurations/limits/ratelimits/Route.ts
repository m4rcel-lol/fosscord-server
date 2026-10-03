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

import { AuthRateLimit } from "./Auth";
import { RateLimitOptions } from "./RateLimitOptions";

export class RouteRateLimit {
    guild: RateLimitOptions = {
        count: 5,
        GET: 50,
        window: 5,
    };
    guildCreate: RateLimitOptions = {
        count: 10,
        window: 60 * 60,
    };
    webhook: RateLimitOptions = {
        count: 10,
        window: 5,
    };
    channel: RateLimitOptions = {
        count: 10,
        GET: 50,
        window: 5,
    };
    user: RateLimitOptions = {
        count: 10,
        window: 10,
    };
    userProfile: RateLimitOptions = {
        count: 5,
        window: 60,
    };
    invite: RateLimitOptions = {
        count: 5,
        window: 10,
    };
    application: RateLimitOptions = {
        count: 10,
        bot: 50,
        window: 10,
    };
    expression: RateLimitOptions = {
        count: 20,
        window: 60,
    };
    interaction: RateLimitOptions = {
        count: 10,
        window: 5,
    };
    oauth2: RateLimitOptions = {
        count: 5,
        window: 10,
    };
    report: RateLimitOptions = {
        count: 5,
        window: 60,
    };
    readState: RateLimitOptions = {
        count: 10,
        window: 10,
    };
    stream: RateLimitOptions = {
        count: 10,
        window: 60,
    };
    connection: RateLimitOptions = {
        count: 5,
        window: 60,
    };
    attachment: RateLimitOptions = {
        count: 20,
        window: 10,
    };
    auth: AuthRateLimit = new AuthRateLimit();
}
