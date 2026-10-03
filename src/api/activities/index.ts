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

import fs from "node:fs";
import path from "node:path";
import { In, IsNull } from "typeorm";
import {
    ActivityInstance,
    ActivityInstances,
    Application,
    ApplicationCommand,
    ApplicationTester,
    ApplicationTesterState,
    Channel,
    EmbeddedActivity,
    Session,
    VoiceState,
} from "@spacebar/database";
import { ApplicationCommandHandlerType, ApplicationCommandType, ChannelType } from "@spacebar/schemas";
import { DiscordApiErrors, getPermission, Snowflake, uploadFile } from "@spacebar/util";
import { activityConfig, toPublicApplication } from "@spacebar/api/util/handlers/Application";
import { getSystemAccount } from "@spacebar/api/util/utility/systemAccounts";
import { ACTIVITY_ASSETS, BuiltinActivity } from "./common";
import { whiteboard } from "./whiteboard";

export * from "./common";

export const APPLICATION_EMBEDDED = 1 << 17;
export const APPLICATION_EMBEDDED_RELEASED = 1 << 1;
const EMBEDDED_FLAGS = APPLICATION_EMBEDDED_RELEASED | APPLICATION_EMBEDDED | (1 << 20);
const LAUNCHABLE_CHANNELS = [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE, ChannelType.DM, ChannelType.GROUP_DM];

export const BUILTIN_ACTIVITIES: Record<string, BuiltinActivity> = { [whiteboard.key]: whiteboard };

export function activityApplication(activity: EmbeddedActivity) {
    return { ...toPublicApplication(activity.application), embedded_activity_config: activityConfig(activity), embedded_surfaces: [0] };
}

const withAssets = (activity: EmbeddedActivity) => [...(activity.application.assets ?? []), ...activity.assets];

export async function testerApplicationIds(userId: string) {
    return (await ApplicationTester.find({ where: { user_id: userId, state: ApplicationTesterState.ACCEPTED }, select: { application_id: true } })).map((t) => t.application_id);
}

export async function canTestApplication(userId: string, application: Application) {
    return application.owner_id === userId || ApplicationTester.exists({ where: { application_id: application.id, user_id: userId, state: ApplicationTesterState.ACCEPTED } });
}

export async function activityShelf(userId?: string) {
    const shelved = await EmbeddedActivity.find({ where: { on_shelf: true }, relations: { application: { bot: true } }, order: { shelf_rank: "ASC" } });
    const testerIds = userId ? await testerApplicationIds(userId) : [];
    const developing = userId
        ? await EmbeddedActivity.find({
              where: [
                  { on_shelf: false, builtin: IsNull(), application: { owner_id: userId } },
                  ...(testerIds.length ? [{ on_shelf: false, builtin: IsNull(), application_id: In(testerIds) }] : []),
              ],
              relations: { application: { bot: true } },
              order: { shelf_rank: "ASC" },
          })
        : [];
    const activities = [...shelved, ...developing].filter((a) => a.application.flags & APPLICATION_EMBEDDED);
    return {
        activities: activities.map(activityConfig),
        applications: activities.map(activityApplication),
        assets: Object.fromEntries(activities.map((a) => [a.application_id, withAssets(a)])),
    };
}

async function ensureEntryPoint(applicationId: string, name: string) {
    const command = {
        name: "launch",
        description: `Launch ${name}`.slice(0, 100),
        handler: ApplicationCommandHandlerType.DISCORD_LAUNCH_ACTIVITY,
        integration_types: [0, 1],
        contexts: [0, 1, 2],
    };
    const existing = await ApplicationCommand.findOne({ where: { application_id: applicationId, type: ApplicationCommandType.PRIMARY_ENTRY_POINT } });
    if (!existing) await ApplicationCommand.create({ application_id: applicationId, type: ApplicationCommandType.PRIMARY_ENTRY_POINT, options: [], ...command }).save();
    else if (existing.description !== command.description || existing.handler !== command.handler) await ApplicationCommand.update({ id: existing.id }, command);
}

export async function ownedEmbeddedActivity(applicationId: string, userId: string) {
    const app = await Application.findOne({ where: { id: applicationId }, select: { id: true, owner_id: true } });
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (app.owner_id !== userId) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
    const activity = await EmbeddedActivity.findOne({ where: { application_id: app.id } });
    if (!activity || activity.builtin) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    return activity;
}

export async function enableApplicationActivity(application: Application) {
    await EmbeddedActivity.createQueryBuilder()
        .insert()
        .values({ application_id: application.id, url_mappings: [], config: {}, assets: [], shelf_rank: 1000, on_shelf: false })
        .orIgnore()
        .execute();
    await ensureEntryPoint(application.id, application.name);
}

export async function launchActivity(opts: { userId: string; applicationId: string; channelId: string; sessionId?: string; nonce?: string }) {
    const activity = await EmbeddedActivity.findOne({ where: { application_id: opts.applicationId }, relations: { application: true } });
    if (!activity || !(activity.application.flags & APPLICATION_EMBEDDED)) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const channel = await Channel.findOne({ where: { id: opts.channelId }, relations: { recipients: true } });
    if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    if (!LAUNCHABLE_CHANNELS.includes(channel.type)) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;

    const permission = await getPermission(opts.userId, channel.guild_id ?? undefined, channel);
    permission.hasThrow("VIEW_CHANNEL");
    if (channel.guild_id) permission.hasThrow("USE_EMBEDDED_ACTIVITIES");

    const released = activity.on_shelf || activity.application.flags & APPLICATION_EMBEDDED_RELEASED;
    if (
        !released &&
        !(await canTestApplication(opts.userId, activity.application)) &&
        !(await ActivityInstance.exists({ where: { application_id: activity.application_id, channel_id: channel.id } }))
    )
        throw DiscordApiErrors.UNKNOWN_APPLICATION;

    const voiceState = await VoiceState.findOne({ where: { user_id: opts.userId, channel_id: channel.id } });
    if (!voiceState) throw DiscordApiErrors.TARGET_USER_IS_NOT_CONNECTED_TO_VOICE;
    const ownSession = opts.sessionId && (await Session.exists({ where: { user_id: opts.userId, session_id: opts.sessionId } }));

    return ActivityInstances.join({
        applicationId: opts.applicationId,
        channelId: channel.id,
        guildId: channel.guild_id,
        userId: opts.userId,
        sessionId: ownSession ? opts.sessionId! : voiceState.session_id,
        nonce: opts.nonce,
    });
}

async function uploadBuiltinAssets(builtin: BuiltinActivity, activity: EmbeddedActivity) {
    const read = (file: string) => fs.readFileSync(path.join(ACTIVITY_ASSETS, builtin.key, file));
    const upload = async (target: string, file: string) => (await uploadFile(target, { buffer: read(file), mimetype: "image/png", originalname: file })).id;

    const assets = [];
    for (const asset of builtin.assets) assets.push({ id: await upload(`/app-assets/${activity.application_id}`, asset.file), name: asset.name, type: 1 });
    const icon = await upload(`/app-icons/${activity.application_id}`, builtin.icon);
    const cover = builtin.assets.find((a) => a.name === "embedded_cover");
    const cover_image = cover ? await upload(`/app-icons/${activity.application_id}`, cover.file) : undefined;
    await EmbeddedActivity.update({ application_id: activity.application_id }, { assets });
    await Application.update({ id: activity.application_id }, { icon, cover_image });
}

async function ensureBuiltin(builtin: BuiltinActivity) {
    const fields = { name: builtin.name, description: builtin.description, summary: builtin.description, tags: builtin.tags, flags: EMBEDDED_FLAGS };
    let activity = await EmbeddedActivity.findOne({ where: { builtin: builtin.key }, relations: { application: true } });
    if (!activity) {
        const owner = await getSystemAccount("official");
        const application = await Application.create({
            id: Snowflake.generate(),
            ...fields,
            owner,
            verify_key: "",
            bot_public: false,
            hook: false,
            integration_public: false,
            discoverability_state: 1,
        }).save();
        activity = await EmbeddedActivity.create({
            application_id: application.id,
            builtin: builtin.key,
            url_mappings: [{ prefix: "/", target: `builtin://${builtin.key}` }],
            shelf_rank: builtin.shelfRank,
        }).save();
        activity.application = application;
        console.log(`[Activities] Registered the ${builtin.name} activity (${application.id})`);
    } else await Application.update({ id: activity.application_id }, fields);

    await ensureEntryPoint(activity.application_id, builtin.name);

    return activity;
}

export async function initEmbeddedActivities() {
    await ActivityInstances.sweep();
    for (const builtin of Object.values(BUILTIN_ACTIVITIES)) {
        const activity = await ensureBuiltin(builtin);
        if (activity.assets.length && activity.application.icon) continue;
        const attempt = (left: number) =>
            setTimeout(() => {
                uploadBuiltinAssets(builtin, activity).catch((error) => {
                    if (left > 0) return attempt(left - 1);
                    console.error(`[Activities] Could not upload the ${builtin.name} images:`, error?.message ?? error);
                });
            }, 2000).unref();
        attempt(5);
    }
}
