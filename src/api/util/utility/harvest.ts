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

import zlib from "node:zlib";
import { In, LessThan } from "typeorm";
import { storage } from "@spacebar/cdn/util/Storage";
import { Channel, ConnectedAccount, Guild, HarvestRecord, Member, Message, Relationship, User } from "@spacebar/database";
import { Config, Email, Snowflake } from "@spacebar/util";
import { PrivateUserProjection } from "@spacebar/schemas";
import { signTicket } from "./mfa";

export const HARVEST_BACKENDS = ["Account", "Analytics", "Activities", "Messages", "Servers", "Zendesk"];

export enum HarvestStatus {
    QUEUED = 0,
    RUNNING = 1,
    FAILED = 2,
    COMPLETED = 3,
}

export type Harvest = HarvestRecord;

class ZipWriter {
    private readonly time: number;
    private readonly date: number;
    private chunks: Buffer[] = [];
    private central: Buffer[] = [];
    private offset = 0;

    constructor(now = new Date()) {
        this.time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
        this.date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    }

    add(name: string, content: string | Buffer) {
        const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
        const compressed = zlib.deflateRawSync(data);
        const fileName = Buffer.from(name, "utf8");
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(this.time, 10);
        local.writeUInt16LE(this.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(fileName.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt16LE(this.time, 12);
        entry.writeUInt16LE(this.date, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(compressed.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(fileName.length, 28);
        entry.writeUInt32LE(this.offset, 42);
        this.central.push(entry, fileName);
        this.chunks.push(local, fileName, compressed);
        this.offset += local.length + fileName.length + compressed.length;
    }

    finish() {
        const directory = Buffer.concat(this.central);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(this.central.length / 2, 8);
        end.writeUInt16LE(this.central.length / 2, 10);
        end.writeUInt32LE(directory.length, 12);
        end.writeUInt32LE(this.offset, 16);
        return Buffer.concat([...this.chunks, directory, end]);
    }
}

const json = (value: unknown) => JSON.stringify(value, null, 4);

export const harvestPath = (user_id: string, harvest_id: string) => `harvests/${user_id}/${harvest_id}.zip`;

export function downloadUrl(user_id: string, harvest_id: string) {
    const token = signTicket({ typ: "harvest", uid: user_id, hid: harvest_id }, 14 * 24 * 3600);
    return `${Config.get().api.endpointPublic?.replace(/\/+$/, "")}/data-packages/${token}`;
}

async function buildPackage(user_id: string, backends: string[]) {
    const zip = new ZipWriter();
    const { instanceName } = Config.get().general;
    zip.add(
        "README.txt",
        `This is your ${instanceName} data package.\n\nAccount/user.json has your account, settings, connections and relationships.\nServers/index.json lists the servers you are in, with details in Servers/<id>/guild.json.\nMessages/index.json lists every channel you sent messages in, and Messages/c<id>/messages.json has those messages.\n`,
    );

    if (backends.includes("Account")) {
        const user = await User.findOneOrFail({
            where: { id: user_id },
            select: Object.fromEntries([...PrivateUserProjection, "created_at"].map((x) => [x, true])),
            relations: { settings: true },
        });
        const [connections, relationships] = await Promise.all([
            ConnectedAccount.find({ where: { user_id } }),
            Relationship.find({ where: { from_id: user_id }, relations: { to: true } }),
        ]);
        zip.add(
            "Account/user.json",
            json({
                ...user.toPrivateUser(),
                created_at: user.created_at,
                settings: user.settings,
                connections: connections.map((x) => ({ type: x.type, id: x.external_id, name: x.name })),
                relationships: relationships.map((x) => ({ id: x.to_id, type: x.type, nickname: x.nickname ?? null, user: x.to?.toPublicUser() })),
            }),
        );
    }

    if (backends.includes("Servers")) {
        const members = await Member.find({ where: { id: user_id }, select: { guild_id: true, nick: true, joined_at: true } });
        const guilds = members.length ? await Guild.find({ where: { id: In(members.map((x) => x.guild_id)) }, select: { id: true, name: true, owner_id: true } }) : [];
        zip.add("Servers/index.json", json(Object.fromEntries(guilds.map((x) => [x.id, x.name]))));
        for (const guild of guilds) {
            const member = members.find((x) => x.guild_id === guild.id);
            zip.add(
                `Servers/${guild.id}/guild.json`,
                json({ id: guild.id, name: guild.name, owner: guild.owner_id === user_id, nick: member?.nick ?? null, joined_at: member?.joined_at }),
            );
        }
    }

    if (backends.includes("Messages")) {
        const byChannel = new Map<string, { ID: string; Timestamp: string; Contents: string; Attachments: string }[]>();
        let before: string | undefined;
        for (;;) {
            const batch = await Message.find({
                where: { author_id: user_id, ...(before ? { id: LessThan(before) } : {}) },
                select: { id: true, channel_id: true, content: true, timestamp: true },
                relations: { attachments: true },
                order: { id: "DESC" },
                take: 1000,
            });
            if (!batch.length) break;
            for (const message of batch) {
                const list = byChannel.get(message.channel_id!) ?? [];
                list.push({
                    ID: message.id,
                    Timestamp: message.timestamp.toISOString(),
                    Contents: message.content ?? "",
                    Attachments: (message.attachments ?? []).map((x) => x.toJSON().url).join(" "),
                });
                byChannel.set(message.channel_id!, list);
            }
            before = batch[batch.length - 1].id;
        }
        const channels = byChannel.size
            ? await Channel.find({
                  where: { id: In([...byChannel.keys()]) },
                  select: { id: true, name: true, type: true, guild_id: true },
                  relations: { guild: true, recipients: { user: true } },
              })
            : [];
        const index: Record<string, string | null> = {};
        for (const [channel_id, messages] of byChannel) {
            const channel = channels.find((x) => x.id === channel_id);
            const recipients = channel?.recipients?.filter((x) => x.user_id !== user_id).map((x) => x.user?.username) ?? [];
            index[channel_id] = channel?.guild
                ? `${channel.name} in ${channel.guild.name}`
                : recipients.length
                  ? `Direct Message with ${recipients.join(", ")}`
                  : (channel?.name ?? null);
            zip.add(
                `Messages/c${channel_id}/channel.json`,
                json({ id: channel_id, type: channel?.type, name: channel?.name, guild: channel?.guild ? { id: channel.guild.id, name: channel.guild.name } : undefined }),
            );
            zip.add(`Messages/c${channel_id}/messages.json`, json(messages.reverse()));
        }
        zip.add("Messages/index.json", json(index));
    }

    return zip.finish();
}

async function save(user_id: string, harvest: Harvest) {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });
    await User.update({ id: user_id }, { account_preferences: { ...user.account_preferences, harvest } });
}

export async function getHarvest(user_id: string) {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });
    return user.account_preferences?.harvest ?? null;
}

export async function createHarvest(user_id: string, requested: unknown) {
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, email: true, username: true } });
    const valid = Array.isArray(requested) ? requested.filter((x): x is string => HARVEST_BACKENDS.includes(x)) : [];
    const backends = valid.length ? valid : HARVEST_BACKENDS;
    const now = new Date().toISOString();
    const harvest: Harvest = {
        harvest_id: Snowflake.generate(),
        user_id,
        email: user.email ?? "",
        state: "INCOMPLETE",
        status: HarvestStatus.QUEUED,
        created_at: now,
        completed_at: null,
        polled_at: null,
        updated_at: now,
        backends: Object.fromEntries(backends.map((x) => [x.toLowerCase(), "INITIAL"])),
        shadow_run: false,
        harvest_metadata: { user_is_staff: false, sla_email_sent: false, bypass_cooldown: false, is_provisional: false },
    };
    await save(user_id, harvest);

    setImmediate(async () => {
        try {
            const data = await buildPackage(user_id, backends);
            await storage.set(harvestPath(user_id, harvest.harvest_id), data);
            const done = new Date().toISOString();
            const finished = {
                ...harvest,
                state: "DELIVERED",
                status: HarvestStatus.COMPLETED,
                completed_at: done,
                updated_at: done,
                backends: Object.fromEntries(Object.keys(harvest.backends).map((x) => [x, "EXTRACTED"])),
            };
            await save(user_id, finished);
            const url = downloadUrl(user_id, harvest.harvest_id);
            if (!Email.transporter || !user.email) return console.log(`[Email] no mail provider configured, data package for ${user.username} (${user_id}) is ready at ${url}`);
            const { instanceName } = Config.get().general;
            await Email.transporter.sendMail({
                from: Config.get().email.senderAddress || Config.get().general.correspondenceEmail || "noreply@localhost",
                to: user.email,
                subject: `Your ${instanceName} data package is ready`,
                text: `Hey ${user.username},\n\nYour data package is ready. Download it here within 14 days: ${url}`,
                html: `<p>Hey ${user.username},</p><p>Your data package is ready. <a href="${url}">Download it here</a> within 14 days.</p>`,
            });
        } catch (e) {
            console.error(`[Harvest] failed to build data package for ${user_id}`, e);
            await save(user_id, { ...harvest, state: "FAILED", status: HarvestStatus.FAILED, updated_at: new Date().toISOString() }).catch(() => undefined);
        }
    });

    return harvest;
}
