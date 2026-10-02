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

import { ApplicationCommandType, InteractionType } from "@spacebar/schemas";
import { Snowflake } from "@spacebar/util";

export interface PendingInteraction {
    id: Snowflake;
    token: string;
    timeout?: NodeJS.Timeout;
    expires: NodeJS.Timeout;
    applicationId: string;
    userId: string;
    sessionId?: string;
    channelId: string;
    guildId?: string;
    nonce?: string;
    messageId?: string;
    messageEphemeral?: boolean;
    type: InteractionType;
    commandType?: ApplicationCommandType;
    commandName?: string;
    commandId?: string;
    targetId?: string;
    customId?: string;
    componentType?: number;
    triggeringInteraction?: Omit<PendingInteraction, "expires" | "timeout" | "triggeringInteraction">;
    acknowledged: boolean;
    responseMessageId?: string;
    responseEphemeral?: boolean;
    responseLoading?: boolean;
}

export const INTERACTION_TOKEN_LIFETIME = 15 * 60 * 1000;

export const pendingInteractions = new Map<Snowflake, PendingInteraction>();
const interactionsByToken = new Map<string, Snowflake>();

export function storeInteraction(interaction: Omit<PendingInteraction, "expires" | "acknowledged">) {
    const stored: PendingInteraction = {
        ...interaction,
        acknowledged: false,
        expires: setTimeout(() => {
            pendingInteractions.delete(interaction.id);
            interactionsByToken.delete(interaction.token);
        }, INTERACTION_TOKEN_LIFETIME),
    };
    pendingInteractions.set(interaction.id, stored);
    interactionsByToken.set(interaction.token, interaction.id);
    return stored;
}

export function getInteractionByToken(applicationId: string, token: string) {
    const id = interactionsByToken.get(token);
    const interaction = id ? pendingInteractions.get(id) : undefined;
    if (!interaction || interaction.applicationId !== applicationId) return undefined;
    return interaction;
}
