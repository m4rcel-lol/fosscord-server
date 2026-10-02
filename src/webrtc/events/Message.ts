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

import { CLOSECODES } from "@spacebar/gateway";
import OPCodeHandlers from "../opcodes";
import { VoiceOPCodes, VoicePayload, WebRtcWebSocket } from "../util";

export async function onMessage(this: WebRtcWebSocket, buffer: Buffer, isBinary: boolean) {
    try {
        const data: VoicePayload = isBinary ? { op: buffer[0], d: buffer.subarray(1) } : JSON.parse(buffer.toString());
        if (![VoiceOPCodes.IDENTIFY, VoiceOPCodes.RESUME, VoiceOPCodes.HEARTBEAT].includes(data.op) && !this.user_id) return this.close(CLOSECODES.Not_authenticated);

        const OPCodeHandler = OPCodeHandlers[data.op];
        if (!OPCodeHandler) {
            console.error(`[WebRTC] Unknown opcode ${data.op}`);
            return;
        }

        if (![VoiceOPCodes.HEARTBEAT, VoiceOPCodes.SPEAKING].includes(data.op as VoiceOPCodes)) {
            console.log(`[WebRTC] Opcode ${VoiceOPCodes[data.op]}`);
        }

        return await OPCodeHandler.call(this, data);
    } catch (error) {
        console.error("[WebRTC] error", error);
    }
}
