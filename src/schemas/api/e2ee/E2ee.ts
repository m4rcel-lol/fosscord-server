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

export interface E2eeEnvelopeKey {
    user_id: string;
    device_id: string;
    prekey_id: number;
    enc: string;
    wrapped: string;
}

export interface E2eeEnvelope {
    v: number;
    alg: string;
    sender_device: string;
    mid?: string;
    iv: string;
    ct: string;
    keys: E2eeEnvelopeKey[];
    sig: string;
}

export interface E2eePrekeySchema {
    id: number;
    public_key: string;
    signature: string;
}

export interface E2eeIdentityUpdateSchema {
    public_key: string;
}

export interface E2eeDeviceCreateSchema {
    device_id: string;
    signing_key: string;
    identity_signature?: string;
    name?: string;
    prekey: E2eePrekeySchema;
}

export interface E2eeKeysQuerySchema {
    user_ids?: string[];
    channel_id?: string;
}

export interface ChannelE2eeUpdateSchema {
    enabled: boolean;
}

export type E2eeDeviceStatus = "active" | "pending" | "revoked";

export interface E2eeDeviceResponse {
    device_id: string;
    signing_key: string;
    identity_signature: string | null;
    status: E2eeDeviceStatus;
    name: string | null;
    prekey: E2eePrekeySchema;
    created_at: string;
}

export interface E2eeUserKeysResponse {
    identity_key: string | null;
    devices: E2eeDeviceResponse[];
}

export interface E2eeKeysQueryResponse {
    users: { [user_id: string]: E2eeUserKeysResponse };
    channel_members?: string[];
}

export interface E2eeStateResponse {
    identity_key: string | null;
    devices: E2eeDeviceResponse[];
    channels: string[];
}

export interface ChannelE2eeResponse {
    channel_id: string;
    enabled: boolean;
    enabled_at: string | null;
}
