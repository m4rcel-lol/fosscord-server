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

import { PartialEmoji } from "@spacebar/schemas";

export interface MessageComponent {
    type: MessageComponentType;
    id?: number;
}

export interface SectionComponent extends MessageComponent {
    type: MessageComponentType.Section;
    /**
     * @maxItems 3
     */
    components: TextDisplayComponent[];
    accessory: ThumbnailComponent | ButtonComponent;
}

export interface ThumbnailComponent extends MessageComponent {
    type: MessageComponentType.Thumbnail;
    /**
     * @maxLength 1024
     */
    description?: string;
    media: UnfurledMediaItem;
    spoiler?: boolean;
}
export interface UnfurledMediaItem {
    id?: string;
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
    flags?: number;
    content_type?: string;
    content_scan_metadata?: unknown; //TODO deal with this lol
    placeholder_version?: number;
    placeholder?: string;
    loading_state?: number;
    attachment_id?: string;
}
export interface TextDisplayComponent extends MessageComponent {
    type: MessageComponentType.TextDisplay;
    /**
     * @maxLength 4000
     */
    content: string;
}
export interface MediaGalleryComponent extends MessageComponent {
    type: MessageComponentType.MediaGallery;
    /**
     * @maxItems 10
     */
    items: {
        media: UnfurledMediaItem;
        /**
         * @maxLength 1024
         */
        description?: string;
        spoiler?: boolean;
    }[];
}

export interface FileComponent extends MessageComponent {
    type: MessageComponentType.File;
    file: UnfurledMediaItem;
    spoiler: boolean;
    name: string;
    size: number;
}
export const enum SeperatorSpacing {
    Small = 1,
    Large = 2,
}
export interface SeperatorComponent extends MessageComponent {
    type: MessageComponentType.Separator;
    divider?: boolean;
    spacing?: SeperatorSpacing;
}

export interface ActionRowComponent extends MessageComponent {
    type: MessageComponentType.ActionRow;
    /**
     * @maxItems 5
     */
    components: (ButtonComponent | StringSelectMenuComponent | SelectMenuComponent | TextInputComponent)[];
}

export interface ContainerComponent extends MessageComponent {
    type: MessageComponentType.Container;
    /**
     * @maxItems 40
     */
    components: (ActionRowComponent | TextDisplayComponent | SectionComponent | MediaGalleryComponent | SeperatorComponent | FileComponent)[];
    accent_color?: number;
    spoiler?: boolean;
}

export type BaseMessageComponents = ActionRowComponent | SectionComponent | TextDisplayComponent | MediaGalleryComponent | FileComponent | SeperatorComponent | ContainerComponent;

export interface ButtonComponent extends MessageComponent {
    type: MessageComponentType.Button;
    style: ButtonStyle;
    /**
     * @maxLength 80
     */
    label?: string;
    emoji?: PartialEmoji;
    /**
     * @maxLength 100
     */
    custom_id?: string;
    sku_id?: string;
    /**
     * @maxLength 512
     */
    url?: string;
    disabled?: boolean;
}

export const enum ButtonStyle {
    Primary = 1,
    Secondary = 2,
    Success = 3,
    Danger = 4,
    Link = 5,
    Premium = 6,
}

export interface SelectMenuComponent extends MessageComponent {
    type:
        | MessageComponentType.StringSelect
        | MessageComponentType.UserSelect
        | MessageComponentType.RoleSelect
        | MessageComponentType.MentionableSelect
        | MessageComponentType.ChannelSelect;
    /**
     * @maxLength 100
     */
    custom_id: string;
    channel_types?: number[];
    /**
     * @maxLength 150
     */
    placeholder?: string;
    /**
     * @maxItems 25
     */
    default_values?: SelectMenuDefaultOption[]; // only for non-string selects
    min_values?: number;
    max_values?: number;
    disabled?: boolean;
}

export interface SelectMenuOption {
    /**
     * @maxLength 100
     */
    label: string;
    /**
     * @maxLength 100
     */
    value: string;
    /**
     * @maxLength 100
     */
    description?: string;
    emoji?: PartialEmoji;
    default?: boolean;
}

export interface SelectMenuDefaultOption {
    id: string;
    type: "user" | "role" | "channel";
}

export interface StringSelectMenuComponent extends SelectMenuComponent {
    type: MessageComponentType.StringSelect;
    /**
     * @maxItems 25
     */
    options: SelectMenuOption[];
}

export interface TextInputComponent extends MessageComponent {
    type: MessageComponentType.TextInput;
    /**
     * @maxLength 100
     */
    custom_id: string;
    style: TextInputStyle;
    /**
     * @maxLength 45
     */
    label: string;
    min_length?: number;
    max_length?: number;
    required?: boolean;
    /**
     * @maxLength 4000
     */
    value?: string;
    /**
     * @maxLength 100
     */
    placeholder?: string;
}

export const enum TextInputStyle {
    Short = 1,
    Paragraph = 2,
}

export const enum MessageComponentType {
    ActionRow = 1,
    Button = 2,
    StringSelect = 3,
    TextInput = 4,
    UserSelect = 5,
    RoleSelect = 6,
    MentionableSelect = 7,
    ChannelSelect = 8,
    Section = 9,
    TextDisplay = 10,
    Thumbnail = 11,
    MediaGallery = 12,
    File = 13,
    Separator = 14,
    // 15 is unknown?
    ContentInventoryEntry = 16, // activity feed entry
    Container = 17,
    Label = 18,
    FileUpload = 19,
    CheckpointCard = 20, // year in review 2026
    RadioGroup = 21,
    CheckboxGroup = 22,
    Checkbox = 23,
}

export const v1CompTypes = new Set([MessageComponentType.ActionRow]);
