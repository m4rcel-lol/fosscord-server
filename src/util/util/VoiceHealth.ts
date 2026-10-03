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

export interface VoiceHealthSnapshot {
    enabled: boolean;
    library: string | null;
    reason?: string;
    started_at?: string;
    listen?: string;
    sfu?: {
        connected: boolean;
        socket: string;
        managed: boolean;
        pid: number | null;
        restarts: number;
        last_exit_code: number | null;
        last_exit_at: string | null;
        ping_ms: number | null;
        ping_error: string | null;
        public_ip: string;
        udp_port: number;
    };
    rooms?: number;
    clients?: number;
    connected_clients?: number;
    dave_sessions?: number;
}

let provider: (() => Promise<VoiceHealthSnapshot>) | null = null;

export const VoiceHealth = {
    register(fn: () => Promise<VoiceHealthSnapshot>) {
        provider = fn;
    },
    async snapshot(): Promise<VoiceHealthSnapshot | null> {
        return provider ? provider() : null;
    },
};
