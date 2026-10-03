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

import { Request, Response, Router } from "express";
import { FrecencyUserSettings } from "discord-protos";
import { JsonValue } from "@protobuf-ts/runtime";
import { route } from "@spacebar/api/middlewares";
import { MoreThan } from "typeorm";
import { Message, Recipient, UserSettingsProtos } from "@spacebar/database";
import { emitEvent, FieldErrors, OrmUtils, Snowflake } from "@spacebar/util";
import { SettingsProtoJsonResponse, SettingsProtoResponse, SettingsProtoUpdateJsonSchema, SettingsProtoUpdateSchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const parseSettings = <T>(parse: () => T) => {
    try {
        return parse();
    } catch {
        throw FieldErrors({ settings: { code: "BASE_TYPE_INVALID", message: "Invalid settings payload." } });
    }
};

const SEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function withSeededFrecency(userId: string, settings: FrecencyUserSettings) {
    const stored = settings.guildAndChannelFrecency?.guildAndChannels ?? {};
    const since = (BigInt(Date.now() - SEED_WINDOW_MS - Snowflake.EPOCH) << 22n).toString();
    const [messages, recipients] = await Promise.all([
        Message.find({
            where: { author_id: userId, id: MoreThan(since) },
            select: { id: true, channel_id: true, guild_id: true },
            order: { id: "DESC" },
            take: 500,
        }),
        Recipient.find({
            where: { user_id: userId, closed: false },
            relations: { channel: true },
            select: { id: true, channel: { id: true, last_message_id: true } },
        }),
    ]);
    const uses = new Map<string, bigint[]>();
    const track = (key: string | undefined | null, at: bigint) => {
        if (!key) return;
        const list = uses.get(key) ?? [];
        list.push(at);
        uses.set(key, list);
    };
    for (const message of messages) {
        const at = BigInt(Snowflake.deconstruct(message.id).timestamp);
        track(message.channel_id, at);
        track(message.guild_id, at);
    }
    for (const { channel } of recipients)
        if (channel?.last_message_id && !uses.has(channel.id)) track(channel.id, BigInt(Snowflake.deconstruct(channel.last_message_id).timestamp));
    const missing = [...uses].filter(([key]) => !stored[key]);
    if (!missing.length) return settings;
    const seeded = missing
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, Math.max(0, 100 - Object.keys(stored).length))
        .map(([key, list]) => [key, { totalUses: list.length, recentUses: list.slice(0, 10).sort((a, b) => (a < b ? -1 : 1)), frecency: -1, score: 0 }]);
    return { ...settings, guildAndChannelFrecency: { guildAndChannels: { ...stored, ...Object.fromEntries(seeded) } } } as FrecencyUserSettings;
}

//#region Protobuf
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "SettingsProtoResponse",
            },
        },
        query: {
            atomic: {
                type: "boolean",
                description: "Whether to try to apply the settings update atomically (default false)",
            },
        },
        spacebarOnly: false, // maps to /users/@me/settings-proto/2
    }),
    async (req: Request, res: Response) => {
        const userSettings = await UserSettingsProtos.getOrDefault(req.user_id);

        res.json({
            settings: FrecencyUserSettings.toBase64(await withSeededFrecency(req.user_id, userSettings.frecencySettings!)),
        } satisfies SettingsProtoResponse);
    },
);

router.patch(
    "/",
    route({
        requestBody: "SettingsProtoUpdateSchema",
        responses: {
            200: {
                body: "SettingsProtoUpdateResponse",
            },
        },
        spacebarOnly: false, // maps to /users/@me/settings-proto/2
    }),
    async (req: Request, res: Response) => {
        const { settings, required_data_version } = req.body as SettingsProtoUpdateSchema;
        const { atomic } = req.query;
        const updatedSettings = parseSettings(() => FrecencyUserSettings.fromBase64(settings));

        const resultObj = await UserSettingsProtos.withLock(req.user_id, () => patchUserSettings(req.user_id, updatedSettings, required_data_version, atomic == "true"));

        res.json({
            settings: FrecencyUserSettings.toBase64(resultObj.settings),
            out_of_date: resultObj.out_of_date,
        });
    },
);

//#endregion
//#region JSON
router.get(
    "/json",
    route({
        responses: {
            200: {
                body: "SettingsProtoJsonResponse",
            },
        },
        spacebarOnly: true,
    }),
    async (req: Request, res: Response) => {
        const userSettings = await UserSettingsProtos.getOrDefault(req.user_id);

        res.json({
            settings: FrecencyUserSettings.toJson(await withSeededFrecency(req.user_id, userSettings.frecencySettings!)),
        } satisfies SettingsProtoJsonResponse);
    },
);

router.patch(
    "/json",
    route({
        requestBody: "SettingsProtoUpdateJsonSchema",
        responses: {
            200: {
                body: "SettingsProtoUpdateJsonResponse",
            },
        },
        query: {
            atomic: {
                type: "boolean",
                description: "Whether to try to apply the settings update atomically (default false)",
            },
        },
        spacebarOnly: true,
    }),
    async (req: Request, res: Response) => {
        const { settings, required_data_version } = req.body as SettingsProtoUpdateJsonSchema;
        const { atomic } = req.query;
        const updatedSettings = parseSettings(() => FrecencyUserSettings.fromJson(settings));

        const resultObj = await UserSettingsProtos.withLock(req.user_id, () => patchUserSettings(req.user_id, updatedSettings, required_data_version, atomic == "true"));

        res.json({
            settings: FrecencyUserSettings.toJson(resultObj.settings),
            out_of_date: resultObj.out_of_date,
        });
    },
);

//#endregion

async function patchUserSettings(userId: string, updatedSettings: FrecencyUserSettings, required_data_version: number | undefined, atomic: boolean = false) {
    const userSettings = await UserSettingsProtos.getOrDefault(userId);
    let settings = userSettings.frecencySettings!;

    if (required_data_version && settings.versions && settings.versions.dataVersion > required_data_version) {
        return {
            settings: settings,
            out_of_date: true,
        };
    }

    if ((process.env.LOG_PROTO_UPDATES || process.env.LOG_PROTO_FRECENCY_UPDATES) && process.env.LOG_PROTO_FRECENCY_UPDATES !== "false")
        console.log(`Updating frecency settings for user ${userId} with atomic=${atomic}:`, updatedSettings);

    if (!atomic) {
        settings = FrecencyUserSettings.fromJson(
            Object.assign(FrecencyUserSettings.toJson(settings) as object, FrecencyUserSettings.toJson(updatedSettings) as object) as JsonValue,
        );
    } else {
        settings = FrecencyUserSettings.fromJson(
            OrmUtils.mergeDeep(FrecencyUserSettings.toJson(settings) as object, FrecencyUserSettings.toJson(updatedSettings) as object) as JsonValue,
        );
    }

    settings.versions = {
        clientVersion: updatedSettings.versions?.clientVersion ?? settings.versions?.clientVersion ?? 0,
        serverVersion: settings.versions?.serverVersion ?? 0,
        dataVersion: (settings.versions?.dataVersion ?? 0) + 1,
    };
    userSettings.frecencySettings = settings;
    await userSettings.save();

    await emitEvent({
        user_id: userId,
        event: "USER_SETTINGS_PROTO_UPDATE",
        data: {
            settings: {
                proto: FrecencyUserSettings.toBase64(settings),
                type: 2,
            },
            json_settings: {
                proto: FrecencyUserSettings.toJson(settings),
                type: "frecency_settings",
            },
            partial: false, // Unsure how this should behave
        },
    });
    // This should also send a USER_SETTINGS_UPDATE event, but that isn't sent
    // when using the USER_SETTINGS_PROTOS capability, so we ignore it for now.

    return {
        settings: settings,
        out_of_date: false,
    };
}

export default router;
