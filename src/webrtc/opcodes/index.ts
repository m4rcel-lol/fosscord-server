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

import { VoiceOPCodes, VoicePayload, WebRtcWebSocket } from "../util";
import { onBackendVersion } from "./BackendVersion";
import { onHeartbeat } from "./Heartbeat";
import { onIdentify } from "./Identify";
import { onResume } from "./Resume";
import { onSelectProtocol } from "./SelectProtocol";
import { onSpeaking } from "./Speaking";
import { onVideo } from "./Video";
import { onDaveInvalidCommitWelcome, onDaveReadyForTransition, onMlsCommitWelcome, onMlsKeyPackage } from "./Dave";

const ignore: OPCodeHandler = async () => {};

export type OPCodeHandler = (this: WebRtcWebSocket, data: VoicePayload) => Promise<void>;

export default {
    [VoiceOPCodes.HEARTBEAT]: onHeartbeat,
    [VoiceOPCodes.IDENTIFY]: onIdentify,
    [VoiceOPCodes.VOICE_BACKEND_VERSION]: onBackendVersion,
    [VoiceOPCodes.VIDEO]: onVideo,
    [VoiceOPCodes.SPEAKING]: onSpeaking,
    [VoiceOPCodes.SELECT_PROTOCOL]: onSelectProtocol,
    [VoiceOPCodes.RESUME]: onResume,
    [VoiceOPCodes.SESSION_UPDATE]: ignore,
    [VoiceOPCodes.MEDIA_SINK_WANTS]: ignore,
    [VoiceOPCodes.NO_ROUTE]: ignore,
    [VoiceOPCodes.DAVE_PROTOCOL_TRANSITION_READY]: onDaveReadyForTransition,
    [VoiceOPCodes.MLS_KEY_PACKAGE]: onMlsKeyPackage,
    [VoiceOPCodes.MLS_COMMIT_WELCOME]: onMlsCommitWelcome,
    [VoiceOPCodes.MLS_INVALID_COMMIT_WELCOME]: onDaveInvalidCommitWelcome,
} as { [key: number]: OPCodeHandler };
