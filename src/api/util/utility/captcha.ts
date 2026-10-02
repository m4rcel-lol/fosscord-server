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

import { Config } from "@spacebar/util";
import { CaptchaRequiredResponse } from "@spacebar/schemas";

export interface CaptchaVerifyResult {
    success: boolean;
    "error-codes"?: string[];
}

const verifyEndpoints = {
    hcaptcha: "https://hcaptcha.com/siteverify",
    recaptcha: "https://www.google.com/recaptcha/api/siteverify",
};

export function captchaEnabled() {
    const { enabled, service, sitekey, secret, instance } = Config.get().security.captcha;
    if (!enabled || !service || !sitekey || !secret) return false;
    return service !== "cap" || !!instance;
}

export function capEndpoint() {
    const { service, sitekey, instance } = Config.get().security.captcha;
    if (service !== "cap" || !sitekey || !instance) return null;
    return `${instance.replace(/\/+$/, "")}/${encodeURIComponent(sitekey)}/`;
}

const verifyCap = async (response: string, secret: string): Promise<CaptchaVerifyResult> => {
    const res = await fetch(`${capEndpoint()}siteverify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response }),
        signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res) return { success: false, "error-codes": ["captcha-unreachable"] };
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; "error-codes"?: string[] };
    if (body.success === true) return { success: true };
    return { success: false, "error-codes": body["error-codes"] ?? [body.error ?? "invalid-input-response"] };
};

export async function verifyCaptcha(response: string, ip?: string): Promise<CaptchaVerifyResult> {
    const { service, secret, sitekey } = Config.get().security.captcha;

    if (!captchaEnabled() || !service || !secret || !sitekey) throw new Error("CAPTCHA is not configured correctly. https://docs.spacebar.chat/setup/server/security/captcha/");

    if (service === "cap") return verifyCap(response, secret);

    const res = await fetch(verifyEndpoints[service], {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body:
            `response=${encodeURIComponent(response)}` +
            `&secret=${encodeURIComponent(secret)}` +
            `&sitekey=${encodeURIComponent(sitekey)}` +
            (ip ? `&remoteip=${encodeURIComponent(ip)}` : ""),
    });

    return (await res.json()) as CaptchaVerifyResult;
}

export async function checkCaptcha(required: boolean, response: string | null | undefined, ip?: string): Promise<CaptchaRequiredResponse | null> {
    if (!required || !captchaEnabled()) return null;
    const { sitekey, service } = Config.get().security.captcha;
    const challenge = (codes: string[]) => ({ captcha_key: codes, captcha_sitekey: sitekey!, captcha_service: service! });
    if (!response) return challenge(["captcha-required"]);
    const verify = await verifyCaptcha(response, ip);
    return verify.success ? null : challenge(verify["error-codes"] ?? ["invalid-input-response"]);
}
