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

import crypto from "node:crypto";

const vapidKeys = () => {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: ecdh.getPrivateKey().toString("base64url") };
};

export class WebPushConfiguration {
    enabled: boolean = true;
    subject: string | null = null;
    vapidPublicKey: string;
    vapidPrivateKey: string;

    constructor() {
        const keys = vapidKeys();
        this.vapidPublicKey = keys.publicKey;
        this.vapidPrivateKey = keys.privateKey;
    }
}
