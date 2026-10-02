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
import bcrypt from "bcrypt";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { verifyToken } from "node-2fa";
import { In } from "typeorm";
import { BackupCode, SecurityKey, Session, User, generateMfaBackupCodes } from "@spacebar/database";
import { EVENT, Event, JwtKeypairManager, UserUpdateEvent, emitEvent } from "@spacebar/util";
import { PrivateUserProjection } from "@spacebar/schemas";

export class ResponseError extends Error {
    constructor(
        public status: number,
        public body: Record<string, unknown>,
    ) {
        super(String(body.message ?? status));
        this.name = "ResponseError";
    }
}

export const MfaInvalidCode = () => new ResponseError(400, { message: "Invalid two-factor code", code: 60008 });
export const MfaInvalidTicket = () => new ResponseError(400, { message: "Invalid two-factor auth ticket", code: 60006 });

type Ticket = { typ: string; uid?: string; ch?: string; origin?: string; [key: string]: unknown };

export const signTicket = (payload: Ticket, expiresIn = 300) => jwt.sign(payload, JwtKeypairManager.keypair.privateKey, { algorithm: "ES512", expiresIn });

export function readTicket<T extends Ticket = Ticket>(token: unknown, typ: string): T | null {
    if (typeof token !== "string" || !token) return null;
    try {
        const decoded = jwt.verify(token, JwtKeypairManager.keypair.publicKey, { algorithms: ["ES512"] }) as T;
        return decoded.typ === typ ? decoded : null;
    } catch {
        return null;
    }
}

export const b64url = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString("base64url");

export function requestOrigin(req: Request) {
    const origin = req.headers.origin;
    if (origin && origin !== "null") return origin;
    return `${req.protocol}://${req.get("host")}`;
}

const rpIdFor = (origin: string) => new URL(origin).hostname;

export function verifyTotp(secret: string | undefined, code: unknown) {
    if (!secret || typeof code !== "string") return false;
    const result = verifyToken(secret, code.replace(/\s/g, ""), 1);
    return !!result && Math.abs(result.delta) <= 1;
}

export async function consumeBackupCode(user_id: string, code: unknown) {
    if (typeof code !== "string") return false;
    const backup = await BackupCode.findOne({
        where: { code: code.replace(/[\s-]/g, "").toLowerCase(), expired: false, consumed: false, user: { id: user_id } },
    });
    if (!backup) return false;
    backup.consumed = true;
    await backup.save();
    return true;
}

export async function authenticatorTypes(user_id: string) {
    const user = await User.findOne({ where: { id: user_id }, select: { id: true, mfa_enabled: true, totp_secret: true } });
    const keys = await SecurityKey.count({ where: { user_id } });
    const types: number[] = [];
    if (keys > 0) types.push(1);
    if (user?.mfa_enabled && user.totp_secret) types.push(2);
    return types;
}

export function assertionOptions(origin: string, credentials: SecurityKey[], userVerification = "preferred", mediation?: string) {
    const challenge = b64url(crypto.randomBytes(32));
    const options = {
        publicKey: {
            challenge,
            timeout: 60000,
            rpId: rpIdFor(origin),
            allowCredentials: credentials.map((key) => ({ type: "public-key", id: Buffer.from(key.key_id, "base64").toString("base64url") })),
            userVerification,
        },
        ...(mediation ? { mediation } : {}),
    };
    return { challenge, options: JSON.stringify(options) };
}

export async function creationOptions(origin: string, user: User) {
    const challenge = b64url(crypto.randomBytes(32));
    const existing = await SecurityKey.find({ where: { user_id: user.id } });
    const options = {
        publicKey: {
            challenge,
            timeout: 60000,
            rp: { id: rpIdFor(origin), name: "Discord" },
            user: { id: b64url(Buffer.from(user.id)), name: user.username, displayName: user.username },
            pubKeyCredParams: [
                { type: "public-key", alg: -7 },
                { type: "public-key", alg: -8 },
                { type: "public-key", alg: -257 },
            ],
            excludeCredentials: existing.map((key) => ({ type: "public-key", id: Buffer.from(key.key_id, "base64").toString("base64url") })),
            authenticatorSelection: { residentKey: "preferred", requireResidentKey: false, userVerification: "preferred" },
            attestation: "none",
        },
    };
    return { challenge, options: JSON.stringify(options) };
}

type CredentialJson = {
    id?: string;
    rawId?: string;
    response?: { clientDataJSON?: string; authenticatorData?: string; signature?: string; userHandle?: string; publicKey?: string; publicKeyAlgorithm?: number };
};

function parseCredential(credential: unknown): CredentialJson | null {
    if (typeof credential === "object" && credential) return credential as CredentialJson;
    if (typeof credential !== "string") return null;
    try {
        return JSON.parse(credential);
    } catch {
        return null;
    }
}

function checkClientData(clientDataJSON: string, type: string, challenge: string, origin: string) {
    const raw = Buffer.from(clientDataJSON, "base64url");
    const data = JSON.parse(raw.toString("utf8"));
    if (data.type !== type || data.challenge !== challenge || data.origin !== origin) return null;
    return raw;
}

function checkAuthData(authData: Buffer, origin: string) {
    if (authData.length < 37) return false;
    const rpIdHash = crypto.createHash("sha256").update(rpIdFor(origin)).digest();
    if (!rpIdHash.equals(authData.subarray(0, 32))) return false;
    return (authData[32] & 0x01) === 0x01;
}

export function verifyAttestation(credential: unknown, challenge: string, origin: string) {
    const cred = parseCredential(credential);
    const response = cred?.response;
    if (!cred?.rawId || !response?.clientDataJSON || !response.authenticatorData || !response.publicKey) return null;
    try {
        if (!checkClientData(response.clientDataJSON, "webauthn.create", challenge, origin)) return null;
        const authData = Buffer.from(response.authenticatorData, "base64url");
        if (!checkAuthData(authData, origin)) return null;
        const publicKey = crypto.createPublicKey({ key: Buffer.from(response.publicKey, "base64url"), format: "der", type: "spki" });
        return {
            key_id: Buffer.from(cred.rawId, "base64url").toString("base64"),
            public_key: publicKey.export({ format: "pem", type: "spki" }).toString(),
            counter: authData.readUInt32BE(33),
        };
    } catch {
        return null;
    }
}

export async function findCredential(credential: unknown, user_id?: string) {
    const cred = parseCredential(credential);
    if (!cred?.rawId) return null;
    const raw = Buffer.from(cred.rawId, "base64url");
    return SecurityKey.findOne({
        where: { key_id: In([raw.toString("base64"), raw.toString("base64url")]), ...(user_id ? { user_id } : {}) },
    });
}

export async function verifyAssertion(credential: unknown, challenge: string, origin: string, key: SecurityKey) {
    const cred = parseCredential(credential);
    const response = cred?.response;
    if (!response?.clientDataJSON || !response.authenticatorData || !response.signature) return false;
    try {
        const clientData = checkClientData(response.clientDataJSON, "webauthn.get", challenge, origin);
        if (!clientData) return false;
        const authData = Buffer.from(response.authenticatorData, "base64url");
        if (!checkAuthData(authData, origin)) return false;
        const signed = Buffer.concat([authData, crypto.createHash("sha256").update(clientData).digest()]);
        const publicKey = crypto.createPublicKey(key.public_key);
        const signature = Buffer.from(response.signature, "base64url");
        const valid =
            publicKey.asymmetricKeyType === "ed25519"
                ? crypto.verify(null, signed, publicKey, signature)
                : crypto.verify("sha256", signed, { key: publicKey, dsaEncoding: "der" }, signature);
        if (!valid) return false;
        const counter = authData.readUInt32BE(33);
        if (counter !== 0 || key.counter !== 0) {
            if (counter <= key.counter) return false;
        }
        key.counter = counter;
        await key.save();
        return true;
    } catch {
        return false;
    }
}

export async function mfaChallenge(req: Request, user_id: string) {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, mfa_enabled: true, totp_secret: true, data: true } });
    const keys = await SecurityKey.find({ where: { user_id } });
    const origin = requestOrigin(req);
    const methods: Record<string, unknown>[] = [];
    let ch: string | undefined;
    if (keys.length) {
        const { challenge, options } = assertionOptions(origin, keys);
        ch = challenge;
        methods.push({ type: "webauthn", challenge: options });
    }
    if (user.mfa_enabled && user.totp_secret) methods.push({ type: "totp", backup_codes_allowed: true });
    if (methods.length) methods.push({ type: "backup" });
    else if (user.data?.hash) methods.push({ type: "password" });
    return { ticket: signTicket({ typ: "mfa", uid: user_id, ch, origin }), methods };
}

export async function verifyMfaMethod(user_id: string, type: string, data: unknown, ticket: Ticket) {
    if (type === "totp" || type === "backup") {
        const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, totp_secret: true, mfa_enabled: true } });
        if (type === "totp" && user.mfa_enabled && verifyTotp(user.totp_secret, data)) return true;
        return consumeBackupCode(user_id, data);
    }
    if (type === "password") {
        const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, data: true } });
        return typeof data === "string" && !!user.data?.hash && bcrypt.compare(data, user.data.hash);
    }
    if (type === "webauthn") {
        if (!ticket.ch || !ticket.origin) return false;
        const key = await findCredential(data, user_id);
        return !!key && verifyAssertion(data, ticket.ch, ticket.origin, key);
    }
    return false;
}

function recentMfaToken(req: Request) {
    const header = req.headers["x-discord-mfa-authorization"];
    if (typeof header === "string") return header;
    return req.headers.cookie
        ?.split("; ")
        .find((x) => x.startsWith("__Secure-recent_mfa="))
        ?.slice("__Secure-recent_mfa=".length);
}

export function hasRecentMfa(req: Request) {
    const decoded = readTicket(recentMfaToken(req), "mfa_verified");
    return decoded?.uid === req.user_id;
}

export async function requireMfa(req: Request, opts: { password?: unknown } = {}) {
    if (hasRecentMfa(req)) return;
    if (typeof opts.password === "string") {
        const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, data: true, mfa_enabled: true } });
        const keys = await SecurityKey.count({ where: { user_id: req.user_id } });
        if (!user.mfa_enabled && !keys && user.data?.hash) {
            if (await bcrypt.compare(opts.password, user.data.hash)) return;
            throw passwordMismatch();
        }
    }
    throw new ResponseError(401, { message: "Two factor is required for this operation", code: 60003, mfa: await mfaChallenge(req, req.user_id) });
}

export function issueRecentMfa(res: Response, user_id: string) {
    const token = signTicket({ typ: "mfa_verified", uid: user_id });
    res.cookie("__Secure-recent_mfa", token, { maxAge: 300000, httpOnly: true, sameSite: "lax", path: "/" });
    return token;
}

export async function loginMfaResponse(req: Request, user: User, extra: Record<string, unknown> = {}) {
    const keys = await SecurityKey.find({ where: { user_id: user.id } });
    const totp = !!(user.mfa_enabled && user.totp_secret);
    if (!totp && !keys.length) return null;
    const origin = requestOrigin(req);
    const assertion = keys.length ? assertionOptions(origin, keys) : null;
    return {
        user_id: user.id,
        token: null,
        mfa: true,
        sms: false,
        totp,
        backup: true,
        webauthn: assertion?.options ?? null,
        ticket: signTicket({ ...extra, typ: "login", uid: user.id, ch: assertion?.challenge, origin }),
        login_instance_id: crypto.randomUUID(),
    };
}

export async function emitUserUpdate(user_id: string) {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: Object.fromEntries(PrivateUserProjection.map((x) => [x, true])) });
    await emitEvent({ event: "USER_UPDATE", user_id, data: user.toPrivateUser() } as unknown as UserUpdateEvent);
}

export async function emitUserEvent(user_id: string, event: string, data: unknown) {
    await emitEvent({ event: event as EVENT, user_id, data } as Event);
}

export async function freshBackupCodes(user_id: string) {
    await BackupCode.update({ user: { id: user_id } }, { expired: true });
    const codes = generateMfaBackupCodes(user_id);
    await Promise.all(codes.map((x) => x.save()));
    return codes;
}

export const serializeBackupCodes = (user_id: string, codes: BackupCode[]) => codes.map((x) => ({ user_id, code: x.code, consumed: x.consumed }));

export const passwordMismatch = (field = "password") =>
    new ResponseError(400, {
        message: "Password does not match.",
        code: 50018,
        errors: { [field]: { _errors: [{ code: "PASSWORD_DOES_NOT_MATCH", message: "Password does not match." }] } },
    });

export async function requireAccountPassword(req: Request) {
    const user = await User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, data: true, mfa_enabled: true } });
    const password = req.body?.password;
    if (user.data?.hash && !(typeof password === "string" && (await bcrypt.compare(password, user.data.hash)))) throw passwordMismatch();
    if (user.mfa_enabled) await requireMfa(req);
}

export async function revokeSessions(user_id: string, except?: string) {
    const sessions = await Session.find({ where: { user_id }, select: { session_id: true } });
    for (const session of sessions) {
        if (session.session_id === except) continue;
        await emitEvent({ session_id: session.session_id, event: "SB_SESSION_REMOVE", origin: "Sessions revoked" } as Event);
        await Session.delete({ session_id: session.session_id });
    }
}

export const currentToken = (req: Request) => (req.headers.authorization ?? "").replace(/^(Bot|Bearer) /, "");
