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
import WS from "ws";
import jwt from "jsonwebtoken";
import { JwtKeypairManager, listenEvent } from "@spacebar/util";

const TIMEOUT = 150000;
const HEARTBEAT_INTERVAL = 41250;

const encrypt = (key: crypto.KeyObject, data: Buffer | string) =>
    crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(data)).toString("base64");

export function RemoteAuthConnection(socket: WS) {
    let publicKey: crypto.KeyObject | undefined;
    let encodedKey: string | undefined;
    let nonce: Buffer | undefined;
    let unlisten: (() => Promise<void>) | undefined;
    let lastHeartbeat = Date.now();

    const send = (payload: Record<string, unknown>) => socket.readyState === WS.OPEN && socket.send(JSON.stringify(payload));
    const close = (code: number) => socket.readyState === WS.OPEN && socket.close(code);

    const timeout = setTimeout(() => close(4003), TIMEOUT);
    const heartbeatCheck = setInterval(() => Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL * 2 + 5000 && close(4003), HEARTBEAT_INTERVAL);

    socket.on("close", () => {
        clearTimeout(timeout);
        clearInterval(heartbeatCheck);
        unlisten?.();
    });

    send({ op: "hello", timeout_ms: TIMEOUT, heartbeat_interval: HEARTBEAT_INTERVAL });

    socket.on("message", async (raw) => {
        let message: { op?: string; encoded_public_key?: string; nonce?: string };
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return close(4001);
        }

        switch (message.op) {
            case "heartbeat":
                lastHeartbeat = Date.now();
                return send({ op: "heartbeat_ack" });
            case "init": {
                if (publicKey || typeof message.encoded_public_key !== "string") return close(4001);
                try {
                    publicKey = crypto.createPublicKey({ key: Buffer.from(message.encoded_public_key, "base64"), format: "der", type: "spki" });
                    if (publicKey.asymmetricKeyType !== "rsa") throw new Error("not rsa");
                    encodedKey = message.encoded_public_key;
                    nonce = crypto.randomBytes(32);
                    return send({ op: "nonce_proof", encrypted_nonce: encrypt(publicKey, nonce) });
                } catch {
                    return close(4001);
                }
            }
            case "nonce_proof": {
                if (!publicKey || !nonce || !encodedKey || unlisten) return close(4001);
                if (message.nonce !== nonce.toString("base64url")) return close(4002);
                const fingerprint = crypto.createHash("sha256").update(Buffer.from(encodedKey, "base64")).digest("base64url");
                const key = publicKey;
                const pk = encodedKey;
                unlisten = await listenEvent(`remote-auth:${fingerprint}`, (event) => {
                    const data = event.data as { user?: string; user_id?: string };
                    if (event.event === ("REMOTE_AUTH_PENDING_TICKET" as never) && data.user) send({ op: "pending_ticket", encrypted_user_payload: encrypt(key, data.user) });
                    else if (event.event === ("REMOTE_AUTH_PENDING_LOGIN" as never) && data.user_id) {
                        const ticket = jwt.sign({ typ: "ra_login", uid: data.user_id, pk }, JwtKeypairManager.keypair.privateKey, { algorithm: "ES512", expiresIn: 120 });
                        send({ op: "pending_login", ticket });
                        setTimeout(() => close(1000), 5000);
                    } else if (event.event === ("REMOTE_AUTH_CANCEL" as never)) {
                        send({ op: "cancel" });
                        close(1000);
                    }
                });
                return send({ op: "pending_remote_init", fingerprint });
            }
            default:
                return close(4001);
        }
    });
}
