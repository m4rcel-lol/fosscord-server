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

import { Channel, Guild, Member, Recipient, VoiceChannels, VoiceState } from "@spacebar/database";
import { Payload, WebSocket, genVoiceToken } from "@spacebar/gateway";
import { Config, emitEvent, getPermission, VoiceServerUpdateEvent, VoiceStateUpdateEvent } from "@spacebar/util";
import { ChannelType, ConfigVoiceRegion, VoiceStateUpdateSchema } from "@spacebar/schemas";
import { check } from "./instanceOf";

const VOICE_TYPES = [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE, ChannelType.DM, ChannelType.GROUP_DM];

async function canJoin(userId: string, guildId: string | undefined, channelId: string, currentChannelId?: string) {
    const channel = await Channel.findOne({ where: { id: channelId }, select: { id: true, type: true, guild_id: true, user_limit: true, permission_overwrites: true } });
    if (!channel || !VOICE_TYPES.includes(channel.type)) return null;
    if (!channel.guild_id) return (await Recipient.exists({ where: { channel_id: channelId, user_id: userId } })) ? channel : null;
    if (channel.guild_id !== guildId) return null;

    const permissions = await getPermission(userId, channel.guild_id, channelId);
    if (!permissions.has("VIEW_CHANNEL") || !permissions.has("CONNECT")) return null;
    if (channel.user_limit && currentChannelId !== channelId && !permissions.has("MOVE_MEMBERS")) {
        const count = await VoiceState.count({ where: { channel_id: channelId } });
        if (count >= channel.user_limit) return null;
    }
    return channel;
}

export async function onVoiceStateUpdate(this: WebSocket, data: Payload) {
    const startTime = Date.now();
    check.call(this, VoiceStateUpdateSchema, data.d);
    const body = data.d as VoiceStateUpdateSchema;
    const guildId = body.guild_id ?? undefined;
    const channelId = body.channel_id ?? undefined;

    let voiceState = await VoiceState.findOne({ where: { user_id: this.user_id } });
    if (voiceState && voiceState.session_id !== this.session_id && !channelId) return;

    const previous = voiceState ? { guild_id: voiceState.guild_id, channel_id: voiceState.channel_id } : { guild_id: undefined, channel_id: undefined };
    const channel = channelId ? await canJoin(this.user_id, guildId, channelId, previous.channel_id) : null;
    if (channelId && !channel) return;

    const member = channel?.guild_id ? await Member.findOne({ where: { id: this.user_id, guild_id: channel.guild_id }, relations: { user: true, roles: true } }) : null;
    const channelChanged = previous.channel_id !== (channelId ?? null) || (voiceState?.session_id !== this.session_id && !!channelId);

    if (previous.guild_id && previous.channel_id && channelChanged && voiceState && (!channelId || previous.guild_id !== channel?.guild_id)) {
        const previousMember = await Member.findOne({ where: { id: this.user_id, guild_id: previous.guild_id }, relations: { user: true, roles: true } });
        await emitEvent({
            event: "VOICE_STATE_UPDATE",
            data: { ...voiceState.toPublicVoiceState(), channel_id: null, self_stream: false, self_video: false, member: previousMember?.toPublicMember() },
            guild_id: previous.guild_id,
        } satisfies VoiceStateUpdateEvent);
    } else if (!previous.guild_id && previous.channel_id && channelChanged && voiceState && previous.channel_id !== channelId) {
        await emitEvent({
            event: "VOICE_STATE_UPDATE",
            data: { ...voiceState.toPublicVoiceState(), channel_id: null, guild_id: null, self_stream: false, self_video: false },
            channel_id: previous.channel_id,
        } satisfies VoiceStateUpdateEvent);
    }

    if (!voiceState) voiceState = VoiceState.create({ user_id: this.user_id, deaf: false, mute: false, suppress: false, self_video: false });

    if (voiceState.session_id !== this.session_id) voiceState.token = genVoiceToken();
    voiceState.session_id = this.session_id;
    voiceState.guild_id = (channel?.guild_id ?? null) as string;
    voiceState.channel_id = (channelId ?? null) as string;
    voiceState.self_mute = body.self_mute;
    voiceState.self_deaf = body.self_deaf;
    voiceState.self_video = channelId ? (body.self_video ?? false) : false;
    if (!channelId) voiceState.self_stream = false;
    if (channelChanged) {
        voiceState.connected_at = channelId ? Math.floor(Date.now() / 1000) : null;
        voiceState.mute = member?.mute ?? false;
        voiceState.deaf = member?.deaf ?? false;
        voiceState.suppress = channel?.type === ChannelType.GUILD_STAGE_VOICE;
        voiceState.request_to_speak_timestamp = undefined;
        voiceState.self_stream = false;
    }
    await voiceState.save();

    if (channelId) {
        await emitEvent({
            event: "VOICE_STATE_UPDATE",
            data: { ...voiceState.toPublicVoiceState(), member: member?.toPublicMember() },
            guild_id: channel?.guild_id ?? undefined,
            channel_id: channel?.guild_id ? undefined : channelId,
        } satisfies VoiceStateUpdateEvent);
    } else if (!previous.channel_id) {
        await emitEvent({ event: "VOICE_STATE_UPDATE", data: voiceState.toPublicVoiceState(), user_id: this.user_id } satisfies VoiceStateUpdateEvent);
    }

    if (channelChanged) {
        if (previous.channel_id) await VoiceChannels.occupancyChanged(previous.guild_id, previous.channel_id, this.user_id, false);
        if (channelId) await VoiceChannels.occupancyChanged(channel?.guild_id, channelId, this.user_id, true);
    }

    if (channelChanged && channelId) {
        const guild = channel?.guild_id ? await Guild.findOne({ where: { id: channel.guild_id }, select: { id: true, region: true } }) : null;
        const regions = Config.get().regions;
        const defaultRegion = regions.available.find((r) => r.id === regions.default);
        const guildRegion: ConfigVoiceRegion | undefined = (guild?.region ? regions.available.find((r) => r.id === guild.region) : undefined) ?? defaultRegion;
        if (!guildRegion) throw new Error("Unable to find suitable region due to misconfiguration of regions");

        await emitEvent({
            event: "VOICE_SERVER_UPDATE",
            data: {
                token: voiceState.token,
                guild_id: channel?.guild_id ?? null,
                channel_id: channel?.guild_id ? undefined : channelId,
                endpoint: guildRegion.endpoint,
            },
            user_id: this.user_id,
        } satisfies VoiceServerUpdateEvent);
    }

    console.log(`[Gateway/${this.user_id}] VOICE_STATE_UPDATE for user ${this.user_id} in channel ${voiceState.channel_id} in guild ${voiceState.guild_id} in ${Date.now() - startTime}ms`);
}
