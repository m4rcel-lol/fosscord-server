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

import { Not } from "typeorm";
import { Recipient, Stream, StreamSession } from "@spacebar/database";
import { genVoiceToken, parseStreamKey, Payload, WebSocket } from "@spacebar/gateway";
import { Config, emitEvent, getPermission, StreamCreateEvent, StreamServerUpdateEvent } from "@spacebar/util";
import { StreamWatchSchema } from "@spacebar/schemas";
import { check } from "./instanceOf";

export async function onStreamWatch(this: WebSocket, data: Payload) {
    const startTime = Date.now();
    check.call(this, StreamWatchSchema, data.d);
    const body = data.d as StreamWatchSchema;

    // TODO: apply perms: check if user is allowed to watch

    let parsedKey: {
        type: "guild" | "call";
        channelId: string;
        guildId?: string;
        userId: string;
    };

    try {
        parsedKey = parseStreamKey(body.stream_key);
    } catch (e) {
        return emitEvent({ event: "STREAM_DELETE", user_id: this.user_id, data: { stream_key: body.stream_key, unavailable: true, reason: "stream_ended" } });
    }

    const { type, channelId, guildId, userId } = parsedKey;

    const stream = await Stream.findOne({
        where: { channel_id: channelId, owner_id: userId },
        relations: { channel: true },
    });

    if (!stream) return emitEvent({ event: "STREAM_DELETE", user_id: this.user_id, data: { stream_key: body.stream_key, unavailable: true, reason: "stream_ended" } });

    if (type === "guild" && stream.channel.guild_id != guildId)
        return emitEvent({ event: "STREAM_DELETE", user_id: this.user_id, data: { stream_key: body.stream_key, unavailable: true, reason: "stream_ended" } });

    const allowed = stream.channel.guild_id
        ? (await getPermission(this.user_id, stream.channel.guild_id, stream.channel_id)).has("VIEW_CHANNEL")
        : await Recipient.exists({ where: { channel_id: stream.channel_id, user_id: this.user_id } });
    if (!allowed) return emitEvent({ event: "STREAM_DELETE", user_id: this.user_id, data: { stream_key: body.stream_key, unavailable: true, reason: "unauthorized" } });

    const regions = Config.get().regions;
    const guildRegion = regions.available.find((r) => r.endpoint === stream.endpoint);

    if (!guildRegion) return emitEvent({ event: "STREAM_DELETE", user_id: this.user_id, data: { stream_key: body.stream_key, unavailable: true, reason: "stream_ended" } });

    const streamSession = StreamSession.create({
        stream_id: stream.id,
        user_id: this.user_id,
        session_id: this.session_id,
        token: genVoiceToken(),
    });

    await streamSession.save();

    // get the viewers: stream session tokens for this stream that have been used but not including stream owner
    const viewers = await StreamSession.find({
        where: {
            stream_id: stream.id,
            used: true,
            user_id: Not(stream.owner_id),
        },
    });

    await emitEvent({
        event: "STREAM_CREATE",
        data: {
            stream_key: body.stream_key,
            rtc_server_id: stream.id, // for voice connections in guilds it is guild_id, for dm voice calls it seems to be DM channel id, for GoLive streams a generated number
            rtc_channel_id: (BigInt(stream.id) - 1n).toString(),
            viewer_ids: viewers.map((v) => v.user_id),
            region: guildRegion.name,
            paused: false,
        },
        channel_id: channelId,
        user_id: this.user_id,
    } satisfies StreamCreateEvent);

    await emitEvent({
        event: "STREAM_SERVER_UPDATE",
        data: {
            token: streamSession.token,
            stream_key: body.stream_key,
            guild_id: null, // not sure why its always null
            endpoint: stream.endpoint,
        },
        user_id: this.user_id,
    } satisfies StreamServerUpdateEvent);

    console.log(`[Gateway/${this.user_id}] STREAM_WATCH for user ${this.user_id} in channel ${channelId} with stream key ${body.stream_key} in ${Date.now() - startTime}ms`);
}
