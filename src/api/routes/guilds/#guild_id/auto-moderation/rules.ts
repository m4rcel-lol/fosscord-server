/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2024 Spacebar and Spacebar Contributors

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
import { AuditLog, AutomodRule } from "@spacebar/database";
import { AuditLogEvents } from "@spacebar/schemas";
import { emitEvent } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { validateAutomodRule } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

const AUDIT_KEYS = ["name", "event_type", "trigger_type", "trigger_metadata", "actions", "enabled", "exempt_roles", "exempt_channels"];

const findRule = async (guild_id: string, rule_id: string) => {
    const rule = /^\d{1,20}$/.test(rule_id) ? await AutomodRule.findOne({ where: { id: rule_id, guild_id } }) : null;
    if (!rule) throw new HTTPError("Unknown Auto Moderation Rule", 404);
    return rule;
};

const emitRule = (event: "AUTO_MODERATION_RULE_CREATE" | "AUTO_MODERATION_RULE_UPDATE" | "AUTO_MODERATION_RULE_DELETE", rule: AutomodRule) =>
    emitEvent({ event, guild_id: rule.guild_id, data: rule.toJSON() });

router.get(
    "/",
    route({
        permission: ["MANAGE_GUILD"],
        responses: {
            200: {
                body: "AutomodRuleSchemaWithId[]",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const rules = await AutomodRule.find({ where: { guild_id }, order: { position: "ASC", id: "ASC" } });
        return res.json(rules.map((rule) => rule.toJSON()));
    },
);

router.post(
    "/validate",
    route({
        permission: ["MANAGE_GUILD"],
        responses: {
            200: {
                body: "AutomodRuleSchemaWithId",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const existing = req.body?.id ? await AutomodRule.findOne({ where: { id: String(req.body.id), guild_id } }) : null;
        const data = await validateAutomodRule(guild_id, req.body ?? {}, existing ?? undefined);
        return res.json({ id: existing?.id ?? req.body?.id ?? null, guild_id, creator_id: existing?.creator_id ?? req.user_id, position: existing?.position ?? 0, ...data });
    },
);

router.get(
    "/:rule_id",
    route({
        permission: ["MANAGE_GUILD"],
        responses: {
            200: {
                body: "AutomodRuleSchemaWithId",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, rule_id } = req.params as { [key: string]: string };
        return res.json((await findRule(guild_id, rule_id)).toJSON());
    },
);

router.post(
    "/",
    route({
        permission: ["MANAGE_GUILD"],
        responses: {
            200: {
                body: "AutomodRuleSchemaWithId",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const data = await validateAutomodRule(guild_id, req.body ?? {});
        const position = Number.isInteger(req.body?.position) ? req.body.position : await AutomodRule.count({ where: { guild_id } });

        const rule = await AutomodRule.create({ ...data, guild_id, creator_id: req.user_id, position }).save();
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.AUTO_MODERATION_RULE_CREATE,
            target_id: rule.id,
            changes: AuditLog.diff({}, rule.toJSON(), AUDIT_KEYS),
            reason: req.headers["x-audit-log-reason"],
        });
        await emitRule("AUTO_MODERATION_RULE_CREATE", rule);
        return res.json(rule.toJSON());
    },
);

router.patch(
    "/:rule_id",
    route({
        permission: ["MANAGE_GUILD"],
        responses: {
            200: {
                body: "AutomodRuleSchemaWithId",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, rule_id } = req.params as { [key: string]: string };
        const rule = await findRule(guild_id, rule_id);
        const before = rule.toJSON();
        const data = await validateAutomodRule(guild_id, req.body ?? {}, rule);

        Object.assign(rule, data);
        if (Number.isInteger(req.body?.position)) rule.position = req.body.position;
        await rule.save();

        const changes = AuditLog.diff(before, rule.toJSON(), AUDIT_KEYS);
        if (changes.length)
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.AUTO_MODERATION_RULE_UPDATE,
                target_id: rule.id,
                changes,
                reason: req.headers["x-audit-log-reason"],
            });
        await emitRule("AUTO_MODERATION_RULE_UPDATE", rule);
        return res.json(rule.toJSON());
    },
);

router.delete(
    "/:rule_id",
    route({
        permission: ["MANAGE_GUILD"],
        responses: {
            204: {},
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, rule_id } = req.params as { [key: string]: string };
        const rule = await findRule(guild_id, rule_id);
        await AutomodRule.delete({ id: rule.id, guild_id });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.AUTO_MODERATION_RULE_DELETE,
            target_id: rule.id,
            changes: AuditLog.diff(rule.toJSON(), {}, AUDIT_KEYS),
            reason: req.headers["x-audit-log-reason"],
        });
        await emitRule("AUTO_MODERATION_RULE_DELETE", rule);
        return res.status(204).send();
    },
);

export default router;
