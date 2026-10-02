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
    backup?: E2eeEnvelopeBackupKey[];
    sig: string;
}

export interface E2eeEnvelopeBackupKey {
    user_id: string;
    enc: string;
    wrapped: string;
}

export interface E2eePrekeySchema {
    id: number;
    public_key: string;
    signature: string;
}

export interface E2eeDeviceSignature {
    device_id: string;
    identity_signature: string;
}

export interface E2eeIdentityUpdateSchema {
    public_key: string;
    previous_signature?: string;
    devices?: E2eeDeviceSignature[];
}

export type E2eeBackupMode = "password" | "recovery";

export interface E2eeBackupKdf {
    name: "argon2id" | "hkdf-sha256";
    memory?: number;
    iterations?: number;
    parallelism?: number;
}

export interface E2eeBackupSecretSchema {
    version: number;
    mode: E2eeBackupMode;
    kdf: E2eeBackupKdf;
    salt: string;
    wrapped_secret: string | null;
}

export interface E2eeBackupSchema extends E2eeBackupSecretSchema {
    identity_key: string;
    wrapped_identity: string;
    backup_public_key: string;
    backup_key_signature: string;
    wrapped_backup_key: string;
}

export interface E2eeBackupResponse extends E2eeBackupSchema {
    updated_at: string;
}

export interface E2eeBackupKeyEntry {
    message_id: string;
    enc: string;
    wrapped: string;
}

export interface E2eeBackupKeysUploadSchema {
    keys: E2eeBackupKeyEntry[];
}

export interface E2eeBackupKeysQuerySchema {
    message_ids: string[];
}

export interface E2eeBackupKeysResponse {
    keys: E2eeBackupKeyEntry[];
}

export type E2eeLinkStage = "request" | "offer" | "reveal" | "approve" | "deny" | "cancel";

export interface E2eeLinkSchema {
    request_id: string;
    stage: E2eeLinkStage;
    device_id: string;
    to_device?: string;
    name?: string;
    commit?: string;
    public_key?: string;
    iv?: string;
    ct?: string;
}

export interface E2eeSignedKey {
    public_key: string;
    signature: string;
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
    session?: E2eeDeviceSession | null;
}

export interface E2eeDeviceSession {
    signed_in: boolean;
    last_seen: string | null;
    os: string | null;
    browser: string | null;
    location: string | null;
}

export interface E2eePasswordSchema {
    password: string;
}

export interface E2eeResetSchema {
    password: string;
    public_key: string;
}

export interface E2eeUserKeysResponse {
    identity_key: string | null;
    previous_identity?: E2eeSignedKey | null;
    backup_key?: E2eeSignedKey | null;
    devices: E2eeDeviceResponse[];
}

export interface E2eeKeysQueryResponse {
    users: { [user_id: string]: E2eeUserKeysResponse };
    channel_members?: string[];
}

export interface E2eeStateResponse {
    identity_key: string | null;
    previous_identity?: E2eeSignedKey | null;
    backup_key?: E2eeSignedKey | null;
    devices: E2eeDeviceResponse[];
    channels: string[];
}

export interface ChannelE2eeResponse {
    channel_id: string;
    enabled: boolean;
    enabled_at: string | null;
}
