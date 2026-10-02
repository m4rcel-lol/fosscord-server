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

import { Channel, User, UserSettings } from "@spacebar/database";
import { Config, Rights, Snowflake } from "@spacebar/util";
import { Embed, Reaction, UserFlags } from "@spacebar/schemas";
import { sendMessage } from "../handlers/Message";
import { reopenDirectMessage } from "../handlers/DirectMessage";

// Two accounts the server speaks through. "official" is a real system account (clients show it as OFFICIAL and
// its dms are read-only); "appeals" is a verified bot, because clients don't allow reactions in system dms and
// staff vote on appeals with reactions. Both are marked with the SYSTEM user flag (private flags only) and the
// 0000 discriminator, which no registered user gets, so a regular user can never be mistaken for one.
const SYSTEM_MARKER = Number(UserFlags.FLAGS.SYSTEM);
const ACCOUNTS = {
    official: { username: "official", name: () => Config.get().general.instanceName, system: true, bot: false },
    appeals: { username: "appeals", name: () => `${Config.get().general.instanceName} Appeals`, system: false, bot: true },
} as const;
export type SystemAccountKind = keyof typeof ACCOUNTS;

// just enough to post (sending, reacting) and to dm everyone at once for announcements
const SYSTEM_RIGHTS = (Rights.FLAGS.SEND_MESSAGES | Rights.FLAGS.SELF_ADD_REACTIONS | Rights.FLAGS.BYPASS_RATE_LIMITS).toString();

const cachedIds: Partial<Record<SystemAccountKind, string>> = {};

export async function getSystemAccount(kind: SystemAccountKind): Promise<User> {
    const spec = ACCOUNTS[kind];
    const cached = cachedIds[kind] ? await User.findOne({ where: { id: cachedIds[kind] } }) : null;
    const found =
        cached ??
        (await User.find({ where: { username: spec.username, discriminator: "0000", system: spec.system, bot: spec.bot } })).find((u) => (Number(u.flags) & SYSTEM_MARKER) !== 0);

    let user = found;
    if (!user) {
        const settings = UserSettings.create({ locale: "en-US" });
        user = User.create({
            id: Snowflake.generate(),
            username: spec.username,
            discriminator: "0000",
            global_name: spec.name(),
            system: spec.system,
            bot: spec.bot,
            verified: true,
            flags: SYSTEM_MARKER,
            public_flags: spec.bot ? Number(UserFlags.FLAGS.VERIFIED_BOT) : 0,
            rights: SYSTEM_RIGHTS,
            premium: false,
            premium_type: 0,
            // no password and no email, so nobody can log in as it
            data: { hash: undefined, valid_tokens_since: new Date() },
            settings,
            created_at: new Date(),
        });
        await settings.save();
        await user.save();
        console.log(`[System] Created the ${kind} account (${user.id})`);
    } else if (user.global_name !== spec.name() || String(user.rights) !== SYSTEM_RIGHTS) {
        // follow the instance name when it changes (and repair accounts created without rights)
        user.global_name = spec.name();
        user.rights = SYSTEM_RIGHTS;
        await User.update({ id: user.id }, { global_name: user.global_name, rights: SYSTEM_RIGHTS });
    }
    cachedIds[kind] = user.id;
    return user;
}

export const isSystemAccount = async (user_id: string) =>
    (await Promise.all((Object.keys(ACCOUNTS) as SystemAccountKind[]).map((k) => getSystemAccount(k)))).some((u) => u.id === user_id);

/** DMs `recipientId` from a system account, opening the dm for them (never as a message request). */
export async function sendSystemDM(kind: SystemAccountKind, recipientId: string, message: { content?: string; embeds?: Embed[]; reactions?: Reaction[] }) {
    const sender = await getSystemAccount(kind);
    const dm = await Channel.createDMChannel([recipientId], sender.id);
    const channel = await Channel.findOneOrFail({ where: { id: dm.id }, relations: { recipients: true } });
    await reopenDirectMessage(channel, sender.id, { neverMessageRequest: true });
    return sendMessage({ channel_id: channel.id, author_id: sender.id, content: message.content ?? "", embeds: message.embeds ?? [], reactions: message.reactions });
}
