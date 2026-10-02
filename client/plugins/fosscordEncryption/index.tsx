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

import SettingsPlugin from "@plugins/_core/settings";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Forms, useEffect, useRef, useState } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

type LayoutNode = { key?: string; type: number; buildLayout?: () => LayoutNode[]; [key: string]: unknown };

const LayoutTypes = findByPropsLazy("SECTION", "SIDEBAR_ITEM", "PANEL", "CUSTOM");

const KEY = "fosscord_encryption";
const AFTER = "data_and_privacy_sidebar_item";
const SEARCH_TERMS = ["Encryption", "End-to-end encryption", "Encrypted messages", "Key backup", "Recovery code", "Devices", "Safety number"];
const LOCK_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z";

function EncryptionPanel() {
    const ref = useRef<HTMLDivElement>(null);
    const [missing, setMissing] = useState(false);
    useEffect(() => {
        const mountSettings = (window as any).__fosscordE2ee?.mountSettings;
        if (!ref.current || typeof mountSettings !== "function") {
            setMissing(true);
            return;
        }
        return mountSettings(ref.current);
    }, []);
    return <div ref={ref}>{missing && <Forms.FormText>End-to-end encryption isn't available in this client build.</Forms.FormText>}</div>;
}

const entry = (): LayoutNode => ({
    key: KEY,
    type: LayoutTypes.SIDEBAR_ITEM,
    useTitle: () => "Encryption",
    icon: () => (
        <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" fillRule="evenodd" d={LOCK_PATH} />
        </svg>
    ),
    buildLayout: () => [
        {
            key: `${KEY}_panel`,
            type: LayoutTypes.PANEL,
            useTitle: () => "Encryption",
            buildLayout: () => [
                {
                    key: `${KEY}_category`,
                    type: LayoutTypes.CATEGORY,
                    buildLayout: () => [{ key: `${KEY}_custom`, type: LayoutTypes.CUSTOM, Component: EncryptionPanel, useSearchTerms: () => SEARCH_TERMS }],
                },
            ],
        },
    ],
});

const inject = (layout: LayoutNode[]) => {
    if (layout.some((node) => node?.key === KEY)) return layout;
    const index = layout.findIndex((node) => node?.key === AFTER);
    layout.splice(index === -1 ? layout.length : index + 1, 0, entry());
    return layout;
};

const wrapped = new WeakSet<LayoutNode>();
let original: ((builder: LayoutNode) => unknown) | null = null;

export default definePlugin({
    name: "FosscordEncryption",
    description: "Adds an Encryption page to User Settings for the key backup, recovery code and encrypted devices.",
    authors: [FosscordAuthor],
    required: true,

    start() {
        const plugin = SettingsPlugin as unknown as { buildLayout: (builder: LayoutNode) => unknown };
        const base = plugin.buildLayout;
        original = base;
        plugin.buildLayout = function (builder: LayoutNode) {
            const layout = base.call(this, builder);
            if (!Array.isArray(layout)) return layout;
            if (builder?.key === "user_section") return inject(layout);
            if (builder?.key !== "$Root") return layout;
            const section = (layout as LayoutNode[]).find((node) => node?.key === "user_section");
            if (section?.buildLayout && !wrapped.has(section)) {
                const build = section.buildLayout;
                section.buildLayout = () => inject(build.call(section));
                wrapped.add(section);
            }
            return layout;
        };
    },

    stop() {
        if (original) (SettingsPlugin as unknown as { buildLayout: unknown }).buildLayout = original;
        original = null;
    },
});
