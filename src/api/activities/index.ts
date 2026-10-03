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
import { ActivityInstances, Application, ApplicationCommand, Channel, EmbeddedActivity, Session, VoiceState } from "@spacebar/database";
import { ApplicationCommandHandlerType, ApplicationCommandType, ChannelType } from "@spacebar/schemas";
import { DiscordApiErrors, getPermission, Snowflake, uploadFile } from "@spacebar/util";
import { activityConfig, toPublicApplication } from "@spacebar/api/util/handlers/Application";
import { getSystemAccount } from "@spacebar/api/util/utility/systemAccounts";
import { ACTIVITY_ASSETS, BuiltinActivity } from "./common";
import { whiteboard } from "./whiteboard";

export * from "./common";

const EMBEDDED_FLAGS = (1 << 1) | (1 << 17) | (1 << 20);
const LAUNCHABLE_CHANNELS = [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE, ChannelType.DM, ChannelType.GROUP_DM];

export const BUILTIN_ACTIVITIES: Record<string, BuiltinActivity> = { [whiteboard.key]: whiteboard };

export function activityApplication(activity: EmbeddedActivity) {
    return { ...toPublicApplication(activity.application), embedded_activity_config: activityConfig(activity), embedded_surfaces: [0] };
}

export async function activityShelf() {
    const activities = await EmbeddedActivity.find({ where: { on_shelf: true }, relations: { application: { bot: true } }, order: { shelf_rank: "ASC" } });
    return {
        activities: activities.map(activityConfig),
        applications: activities.map(activityApplication),
        assets: Object.fromEntries(activities.map((a) => [a.application_id, a.assets])),
    };
}

export async function launchActivity(opts: { userId: string; applicationId: string; channelId: string; sessionId?: string; nonce?: string }) {
    if (!(await EmbeddedActivity.exists({ where: { application_id: opts.applicationId } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const channel = await Channel.findOne({ where: { id: opts.channelId }, relations: { recipients: true } });
    if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    if (!LAUNCHABLE_CHANNELS.includes(channel.type)) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;

    const permission = await getPermission(opts.userId, channel.guild_id ?? undefined, channel);
    permission.hasThrow("VIEW_CHANNEL");
    if (channel.guild_id) permission.hasThrow("USE_EMBEDDED_ACTIVITIES");

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

    const command = {
        name: "launch",
        description: `Launch ${builtin.name}`,
        handler: ApplicationCommandHandlerType.DISCORD_LAUNCH_ACTIVITY,
        integration_types: [0, 1],
        contexts: [0, 1, 2],
    };
    const existing = await ApplicationCommand.findOne({ where: { application_id: activity.application_id, type: ApplicationCommandType.PRIMARY_ENTRY_POINT } });
    if (!existing) await ApplicationCommand.create({ application_id: activity.application_id, type: ApplicationCommandType.PRIMARY_ENTRY_POINT, options: [], ...command }).save();
    else if (existing.description !== command.description || existing.handler !== command.handler) await ApplicationCommand.update({ id: existing.id }, command);

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
