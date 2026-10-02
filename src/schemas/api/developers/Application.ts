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

import { StringStringDictionary } from "../../HelperTypes";

export interface ApplicationCommand {
    id: string;
    application_id: string;
    name: string;
    description: string;
    options?: ApplicationCommandOption[];
}

export interface ApplicationCommandOption {
    type: ApplicationCommandOptionType;
    name: string;
    name_localizations?: StringStringDictionary | null;
    description: string;
    description_localizations?: StringStringDictionary | null;
    required?: boolean;
    choices?: ApplicationCommandOptionChoice[];
    options?: ApplicationCommandOption[];
    channel_types?: number[];
    min_value?: number;
    max_value?: number;
    min_length?: number;
    max_length?: number;
    autocomplete?: boolean;
}

export interface ApplicationCommandOptionChoice {
    name: string;
    name_localizations?: StringStringDictionary | null;
    value: string | number;
}

export enum ApplicationCommandOptionType {
    SUB_COMMAND = 1,
    SUB_COMMAND_GROUP = 2,
    STRING = 3,
    INTEGER = 4,
    BOOLEAN = 5,
    USER = 6,
    CHANNEL = 7,
    ROLE = 8,
    MENTIONABLE = 9,
    NUMBER = 10,
    ATTACHMENT = 11,
}

export interface ApplicationCommandInteractionData {
    id: string;
    name: string;
    options?: ApplicationCommandInteractionDataOption[];
}

export interface ApplicationCommandInteractionDataOption {
    name: string;
    value?: unknown;
    options?: ApplicationCommandInteractionDataOption[];
}
