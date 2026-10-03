/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2025 Spacebar and Spacebar Contributors

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

import fs from "node:fs";
import path from "node:path";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { ReportMenuTypeNames, ReportMenuType, type CreateReportSchema, ReportMenuTypeNameArray } from "@spacebar/schemas";
import { DiscordApiErrors, FieldErrors, getPermission } from "@spacebar/util";
import { Guild, Message, User, UserReport } from "@spacebar/database";
import { MoreThan } from "typeorm";

const router = Router({ mergeParams: true });
if (process.env.LOG_ROUTES !== "false") console.log("[Server] Registering reporting menu routes...");
router.get(
    "/",
    route({
        description: "[EXT] Get available reporting menu types.",
        responses: {
            200: {
                body: "ReportMenuTypeNames",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json(Object.values(ReportMenuTypeNames));
    },
);

for (const type of Object.values(ReportMenuTypeNames)) {
    router.get(
        `/menu/${type}`,
        route({
            description: `Get reporting menu options for ${type} reports.`,
            query: {
                variant: { type: "string", required: false, description: "Version variant of the menu to retrieve (max 256 characters, default active)" },
            },
            responses: {
                200: {
                    body: "ReportingMenuResponse",
                },
                204: {},
            },
            spacebarOnly: false, // Maps to /reporting/menu/:id
        }),
        (req: Request, res: Response) => {
            // TODO: implement
            // res.send([] as ReportingMenuResponseSchema);
            res.sendFile(path.join(__dirname, "..", "..", "..", "..", "assets", "temp_report_menu_responses", `${type}.json`), { dotfiles: "allow" });
        },
    );
    if (process.env.LOG_ROUTES !== "false") console.log(`[Server] Route /reporting/menu/${type} registered (reports).`);
    // noinspection JSUnusedLocalSymbols - TODO: implement
    router.post(
        `/${type}`,
        route({
            description: `Get reporting menu options for ${type} reports.`,
            requestBody: "CreateReportSchema",
            responses: {
                200: {
                    body: "ReportingMenuResponse",
                },
                204: {},
            },
            spacebarOnly: false, // Maps to /reporting/:id
        }),
        async (req: Request, res: Response) => {
            const body = req.body as CreateReportSchema;
            if (body.name !== type)
                throw FieldErrors({
                    name: {
                        message: `Expected report type ${type} but got ${body.name}`,
                        code: "INVALID_REPORT_TYPE",
                    },
                });

            const menuPath = path.join(__dirname, "..", "..", "..", "..", "assets", "temp_report_menu_responses", `${type}.json`);
            const menuData = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
            if (body.version !== menuData.version) {
                throw FieldErrors({
                    version: {
                        message: `Expected report menu version ${menuData.version} but got ${body.version}`,
                        code: "INVALID_REPORT_MENU_VERSION",
                    },
                });
            }

            if (body.variant !== menuData.variant) {
                throw FieldErrors({
                    variant: {
                        message: `Expected report menu variant ${menuData.variant} but got ${body.variant}`,
                        code: "INVALID_REPORT_MENU_VARIANT",
                    },
                });
            }

            if (body.breadcrumbs.find((_) => !(_ in menuData.nodes))) {
                throw FieldErrors({
                    breadcrumbs: {
                        message: `Invalid report menu breadcrumbs.`,
                        code: "INVALID_REPORT_MENU_BREADCRUMBS",
                    },
                });
            }

            const validateBreadcrumbs = (currentNode: unknown, breadcrumbs: number[]): boolean => {
                // navigate via node.children ([name, id][]) according to breadcrumbs
                let node = currentNode as { children: [string, number][]; button?: { target?: number | null } | null };
                for (let i = 1; i < breadcrumbs.length; i++) {
                    const crumb = breadcrumbs[i];
                    if (!node) return false;
                    const viaChild = Array.isArray(node.children) && node.children.some((child: [string, number]) => child[1] === crumb);
                    if (!viaChild && node.button?.target !== crumb) return false;
                    // load next node
                    const nextNodeData = menuData.nodes[crumb];
                    if (!nextNodeData) return false;
                    node = nextNodeData;
                }
                return true;
            };

            if (!validateBreadcrumbs(menuData.nodes[menuData.root_node_id], body.breadcrumbs))
                throw FieldErrors({
                    breadcrumbs: {
                        message: `Invalid report menu breadcrumbs path.`,
                        code: "INVALID_REPORT_MENU_BREADCRUMBS_PATH",
                    },
                });

            const requireFields = (obj: CreateReportSchema, fields: string[]) => {
                const missingFields: string[] = [];
                for (const field of fields) if (!(field in obj)) missingFields.push(field);

                if (missingFields.length > 0)
                    throw FieldErrors(
                        Object.fromEntries(
                            missingFields.map((f) => [
                                f,
                                {
                                    message: `Missing required field ${f}.`,
                                    code: "MISSING_FIELD",
                                },
                            ]),
                        ),
                    );
            };

            switch (type) {
                case ReportMenuType.GUILD:
                case ReportMenuType.GUILD_DISCOVERY:
                    requireFields(body, ["guild_id"]);
                    break;
                case ReportMenuType.GUILD_DIRECTORY_ENTRY:
                    requireFields(body, ["guild_id", "channel_id"]);
                    break;
                case ReportMenuType.GUILD_SCHEDULED_EVENT:
                    requireFields(body, ["guild_id", "scheduled_event_id"]);
                    break;
                case ReportMenuType.MESSAGE:
                    requireFields(body, ["channel_id", "message_id"]);
                    // NOTE: is body.guild_id set if the channel is in a guild? is body.user_id ever set????
                    break;
                case ReportMenuType.STAGE_CHANNEL:
                    requireFields(body, ["channel_id", "guild_id", "stage_instance_id"]);
                    break;
                case ReportMenuType.FIRST_DM:
                    requireFields(body, ["user_id", "channel_id"]);
                    break;
                case ReportMenuType.USER:
                    requireFields(body, ["reported_user_id"]);
                    break;
                case ReportMenuType.APPLICATION:
                    requireFields(body, ["application_id"]);
                    break;
                case ReportMenuType.WIDGET:
                    requireFields(body, ["user_id", "widget_id"]);
                    break;
                default:
                    throw new HTTPError("Unknown report menu type", 400);
            }

            const recent = await UserReport.count({ where: { reporter_id: req.user_id, created_at: MoreThan(new Date(Date.now() - 60 * 60 * 1000)) } });
            if (recent >= 30) throw new HTTPError("You are sending too many reports. Try again later.", 429);

            const snowflake = (value?: string) => (value && /^\d{1,20}$/.test(value) ? value : null);
            const report = UserReport.create({
                type,
                reporter_id: req.user_id,
                guild_id: snowflake(body.guild_id),
                channel_id: snowflake(body.channel_id),
                message_id: snowflake(body.message_id),
                reported_user_id: snowflake(body.reported_user_id ?? body.user_id),
                breadcrumbs: body.breadcrumbs,
                elements: body.elements ?? {},
            });

            if (type === ReportMenuType.MESSAGE && report.message_id && report.channel_id) {
                const message = await Message.findOne({ where: { id: report.message_id, channel_id: report.channel_id }, relations: { attachments: true } });
                if (!message) throw DiscordApiErrors.UNKNOWN_MESSAGE;
                const permission = await getPermission(req.user_id, message.guild_id ?? undefined, report.channel_id);
                if (!permission.has("VIEW_CHANNEL")) throw DiscordApiErrors.UNKNOWN_MESSAGE;
                report.guild_id = message.guild_id ?? null;
                report.reported_user_id = message.author_id ?? null;
                report.snapshot = {
                    content: message.content ?? "",
                    author_id: message.author_id,
                    attachments: (message.attachments ?? []).map((a) => ({ id: a.id, url: a.toJSON().url, filename: a.filename, content_type: a.content_type ?? null })),
                    embeds: message.embeds?.length ?? 0,
                    timestamp: message.timestamp?.toISOString(),
                };
            } else if (type === ReportMenuType.GUILD || type === ReportMenuType.GUILD_DISCOVERY) {
                const guild = report.guild_id ? await Guild.findOne({ where: { id: report.guild_id }, select: { id: true, owner_id: true } }) : null;
                if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;
                report.reported_user_id ??= guild.owner_id ?? null;
            }
            if (report.reported_user_id && !(await User.exists({ where: { id: report.reported_user_id } }))) throw DiscordApiErrors.UNKNOWN_USER;
            if (report.reported_user_id === req.user_id) throw new HTTPError("You can't report yourself.", 400);

            await report.save();
            res.json({ report_id: report.id, id: report.id });
        },
    );
    if (process.env.LOG_ROUTES !== "false") console.log(`[Server] Route /reporting/${type} registered (reports).`);
}
export default router;
