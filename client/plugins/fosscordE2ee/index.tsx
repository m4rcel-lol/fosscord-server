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

import { updateMessage } from "@api/MessageUpdater";
import SettingsPlugin from "@plugins/_core/settings";
import definePlugin, { IconProps } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useRef, useState } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

interface E2eeBridge {
    isEncrypted?: (channelId: string) => boolean;
    beforeSend?: (channelId: string) => boolean;
    mountSettings?: (container: HTMLElement) => () => void;
    updateMessage?: typeof updateMessage;
}

interface LayoutNode {
    key?: string;
    buildLayout?: () => LayoutNode[];
    fosscordE2ee?: boolean;
}

interface SystemMessageProps {
    message: { author?: { username?: string; globalName?: string | null; global_name?: string | null }; timestamp?: unknown };
    compact?: boolean;
}

const ENTRY_KEY = "fosscord_encryption_sidebar_item";
const E2EE_ENABLED_TYPE = 1000;

const SystemMessage = findComponentByCodeLazy("iconContainerClassName", "timestampFormat");
const LOCK_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z";

const bridge = () => (window as unknown as { __fosscordE2ee?: E2eeBridge }).__fosscordE2ee;

const exposeUpdater = () => {
    const target = bridge();
    if (target) target.updateMessage = updateMessage;
    return !!target;
};

const EncryptionIcon = ({ width = 20, height = 20, className }: IconProps) => (
    <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d={LOCK_PATH} />
    </svg>
);

function EncryptionEnabledMessage({ message, compact }: SystemMessageProps) {
    const author = message.author;
    const name = author?.globalName || author?.global_name || author?.username || "Someone";
    return (
        <SystemMessage iconNode={<EncryptionIcon width={16} height={16} />} timestamp={message.timestamp} compact={compact}>
            <span style={{ fontWeight: 500, color: "var(--text-strong, var(--header-primary))" }}>{name}</span> turned on end-to-end encryption. Messages sent before this weren't
            encrypted.
        </SystemMessage>
    );
}

function EncryptionPage() {
    const ref = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(() => !!bridge()?.mountSettings);
    useEffect(() => {
        if (ready) return;
        const timer = setInterval(() => bridge()?.mountSettings && setReady(true), 250);
        return () => clearInterval(timer);
    }, [ready]);
    useEffect(() => {
        const mount = bridge()?.mountSettings;
        if (!ready || !ref.current || !mount) return;
        return mount(ref.current);
    }, [ready]);
    return <div ref={ref} />;
}

const insertEntry = (items: LayoutNode[]) => {
    if (!Array.isArray(items) || items.some((item) => item?.key === ENTRY_KEY)) return items;
    const entry = SettingsPlugin.buildEntry({ key: ENTRY_KEY, title: "Encryption", panelTitle: "Encryption", Component: EncryptionPage, Icon: EncryptionIcon });
    const anchor = items.findIndex((item) => item?.key === "data_and_privacy_sidebar_item");
    items.splice(anchor === -1 ? items.length : anchor + 1, 0, entry as LayoutNode);
    return items;
};

let originalBuildLayout: typeof SettingsPlugin.buildLayout | null = null;

export default definePlugin({
    name: "FosscordE2ee",
    description: "Connects end-to-end encrypted DMs to the composer and adds the Encryption settings page.",
    authors: [FosscordAuthor],
    required: true,
    dependencies: ["MessageEventsAPI"],

    patches: [
        {
            find: "unknown message type ",
            replacement: {
                match: /\{type:(\i)\}=(\i),(\i)=(\i)\[\1\];/,
                replace: "{type:$1}=$2,$3=$4[$1]??$self.systemMessage($1);",
            },
        },
        {
            find: "FORWARDABLE.has(",
            replacement: {
                match: /if\(null==(\i)\|\|!\((\i)\.state!==/,
                replace: "if(null==$1||$self.isEncrypted($1.channel_id)||!($2.state!==",
            },
        },
        {
            find: 'navId:"channel-attach"',
            replacement: {
                match: /id:"(clips|poll)",/g,
                replace: 'id:"$1",disabled:$self.inEncryptedChannel(),subtext:$self.inEncryptedChannel()?"Not available in encrypted conversations":void 0,',
            },
        },
    ],

    systemMessage(type: number) {
        return type === E2EE_ENABLED_TYPE ? EncryptionEnabledMessage : undefined;
    },

    isEncrypted(channelId?: string) {
        return !!channelId && !!bridge()?.isEncrypted?.(channelId);
    },

    inEncryptedChannel() {
        return this.isEncrypted(/^\/channels\/@me\/(\d+)/.exec(location.pathname)?.[1]);
    },

    onBeforeMessageSend(channelId) {
        if (bridge()?.beforeSend?.(channelId)) return { cancel: true };
    },

    onBeforeMessageEdit(channelId) {
        if (bridge()?.beforeSend?.(channelId)) return { cancel: true };
    },

    start() {
        if (!exposeUpdater()) {
            const timer = setInterval(() => exposeUpdater() && clearInterval(timer), 250);
            setTimeout(() => clearInterval(timer), 30000);
        }
        originalBuildLayout = SettingsPlugin.buildLayout;
        const original = originalBuildLayout;
        SettingsPlugin.buildLayout = function (builder) {
            const layout = original.call(this, builder) as LayoutNode[];
            if (builder.key === "user_section") return insertEntry(layout);
            if (builder.key !== "$Root" || !Array.isArray(layout)) return layout;
            const user = layout.find((node) => node?.key === "user_section");
            if (user?.buildLayout && !user.fosscordE2ee) {
                const build = user.buildLayout;
                user.buildLayout = () => insertEntry(build());
                user.fosscordE2ee = true;
            }
            return layout;
        };
    },

    stop() {
        const target = bridge();
        if (target) delete target.updateMessage;
        if (originalBuildLayout) SettingsPlugin.buildLayout = originalBuildLayout;
        originalBuildLayout = null;
    },
});
