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

import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { captchaEnabled } from "@spacebar/api/util";
import { Config } from "@spacebar/util";
import { AdminSettingsUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const pickRate = ({ count, window }: { count: number; window: number }) => ({ count, window });

const pickSettings = () => {
    const { general, client, register, login, passwordReset, security, limits } = Config.get();
    const { captcha } = security;
    return {
        general: {
            instanceName: general.instanceName,
            instanceDescription: general.instanceDescription,
            image: general.image,
            frontPage: general.frontPage,
            tosPage: general.tosPage,
            privacyPage: general.privacyPage,
            guidelinesPage: general.guidelinesPage,
            correspondenceEmail: general.correspondenceEmail,
            correspondenceUserID: general.correspondenceUserID,
        },
        client: {
            instanceName: client.instanceName,
            icon: client.icon,
            logo: client.logo,
            helpUrl: client.helpUrl,
            activityApplicationHost: client.activityApplicationHost,
        },
        register: {
            disabled: register.disabled,
            allowNewRegistration: register.allowNewRegistration,
            requireInvite: register.requireInvite,
            guestsRequireInvite: register.guestsRequireInvite,
            requireCaptcha: register.requireCaptcha,
            allowMultipleAccounts: register.allowMultipleAccounts,
            incrementingDiscriminators: register.incrementingDiscriminators,
            email: { required: register.email.required },
            dateOfBirth: { minimum: register.dateOfBirth.minimum },
            password: {
                minLength: register.password.minLength,
                minNumbers: register.password.minNumbers,
                minUpperCase: register.password.minUpperCase,
                minSymbols: register.password.minSymbols,
            },
        },
        login: { requireCaptcha: login.requireCaptcha },
        passwordReset: { requireCaptcha: passwordReset.requireCaptcha },
        captcha: {
            enabled: captcha.enabled,
            service: captcha.service,
            sitekey: captcha.sitekey,
            instance: captcha.instance,
            secret_set: !!captcha.secret,
            active: captchaEnabled(),
        },
        rate: {
            enabled: limits.rate.enabled,
            ip: pickRate(limits.rate.ip),
            global: pickRate(limits.rate.global),
            error: pickRate(limits.rate.error),
            login: pickRate(limits.rate.routes.auth.login),
            register: pickRate(limits.rate.routes.auth.register),
        },
        e2ee: { ...limits.e2ee },
    };
};

const blankToNull = (value: unknown) => (typeof value === "string" ? value.trim() || null : value);
const nullBlanks = <T extends object>(section: T | undefined, keep: string[] = []) =>
    Object.fromEntries(Object.entries(section ?? {}).map(([k, v]) => [k, keep.includes(k) ? v : blankToNull(v)]));

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Get the instance settings editable from the admin dashboard",
    }),
    (req: Request, res: Response) => {
        res.json(pickSettings());
    },
);

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminSettingsUpdateSchema",
        description: "Update instance information, client branding, registration, captcha, rate limits and e2ee limits",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSettingsUpdateSchema;
        const general = nullBlanks(body.general);
        if (typeof body.general?.instanceName === "string") {
            if (body.general.instanceName.trim()) general.instanceName = body.general.instanceName.trim();
            else delete general.instanceName;
        }
        const client = nullBlanks(body.client);
        if (typeof body.client?.instanceName === "string") {
            if (body.client.instanceName.trim()) client.instanceName = body.client.instanceName.trim();
            else delete client.instanceName;
        }

        const captcha: Record<string, unknown> = nullBlanks(body.captcha, ["secret"]);
        if (typeof captcha.secret === "string") {
            if (captcha.secret.trim()) captcha.secret = captcha.secret.trim();
            else delete captcha.secret;
        }
        if (typeof captcha.instance === "string") captcha.instance = captcha.instance.replace(/\/+$/, "");

        const { login, register: registerRate, ...rate } = body.rate ?? {};

        await Config.set({
            general,
            client,
            register: body.register ?? {},
            login: body.login ?? {},
            passwordReset: body.passwordReset ?? {},
            security: { captcha },
            limits: { rate: { ...rate, routes: { auth: { ...(login ? { login } : {}), ...(registerRate ? { register: registerRate } : {}) } } }, e2ee: body.e2ee ?? {} },
        } as unknown as Parameters<typeof Config.set>[0]);
        res.json(pickSettings());
    },
);

export default router;
