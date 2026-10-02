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

import { ChannelMember, E2eeError, Engine } from "./engine";
import { MessageState } from "./hooks";

const LOCK_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z";
const OPEN_LOCK_PATH = "M9 10h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 9.58-2 1 1 0 1 1-1.83.8A3 3 0 0 0 9 7v3Z";

const css = `
.fe2ee-lock{display:inline-flex;vertical-align:-2px;margin-inline-start:6px;color:var(--text-muted,#949ba4)}
.fe2ee-lock svg{width:14px;height:14px}
.fe2ee-lock[data-state="failed"]{color:var(--status-danger,#f23f43)}
.fe2ee-failed{color:var(--text-muted,#949ba4)}
.fe2ee-toggle{background:none;border:0;padding:0;margin:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--interactive-normal,#b5bac1);transition:color 120ms ease-out,scale 200ms ease-out}
.fe2ee-toggle[aria-pressed="true"]{color:var(--status-positive,#23a55a)}
.fe2ee-toggle:active{scale:.96}
.fe2ee-toggle:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px;border-radius:4px}
@media (hover:hover){.fe2ee-toggle:hover{color:var(--interactive-hover,#dbdee1)}.fe2ee-toggle[aria-pressed="true"]:hover{color:var(--status-positive,#23a55a)}}
.fe2ee-banners{position:fixed;inset-inline:0;top:0;z-index:10000;display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:8px;pointer-events:none}
.fe2ee-banner{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:min(640px,calc(100vw - 32px));padding:10px 12px 10px 14px;border-radius:8px;font-size:14px;line-height:20px;text-wrap:pretty;color:var(--text-default,#dbdee1);background:var(--modal-background,var(--background-base-low,#313338));box-shadow:0 0 0 1px rgb(0 0 0 / .08),0 2px 4px rgb(0 0 0 / .16),0 8px 24px rgb(0 0 0 / .24)}
.fe2ee-banner[data-tone="danger"]{box-shadow:inset 3px 0 0 var(--status-danger,#f23f43),0 0 0 1px rgb(0 0 0 / .08),0 2px 4px rgb(0 0 0 / .16),0 8px 24px rgb(0 0 0 / .24)}
.fe2ee-banner[data-tone="warning"]{box-shadow:inset 3px 0 0 var(--status-warning,#f0b232),0 0 0 1px rgb(0 0 0 / .08),0 2px 4px rgb(0 0 0 / .16),0 8px 24px rgb(0 0 0 / .24)}
.fe2ee-banner svg{flex:none;width:18px;height:18px}
.fe2ee-banner p{margin:0;flex:1}
.fe2ee-button{font:inherit;font-size:14px;font-weight:500;line-height:20px;border:0;border-radius:6px;padding:6px 14px;cursor:pointer;color:#fff;background:var(--button-filled-brand-background,#5865f2);transition:background-color 120ms ease-out,scale 200ms ease-out;white-space:nowrap}
.fe2ee-button[data-variant="secondary"]{color:var(--text-default,#dbdee1);background:var(--button-secondary-background,#4e5058)}
.fe2ee-button:active{scale:.97}
.fe2ee-button:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px}
@media (hover:hover){.fe2ee-button:hover{background:var(--button-filled-brand-background-hover,#4752c4)}.fe2ee-button[data-variant="secondary"]:hover{background:var(--button-secondary-background-hover,#6d6f78)}}
.fe2ee-dialog{border:0;padding:0;border-radius:12px;width:min(480px,calc(100vw - 32px));color:var(--text-default,#dbdee1);background:var(--modal-background,var(--background-base-low,#313338));box-shadow:0 0 0 1px rgb(0 0 0 / .08),0 4px 8px rgb(0 0 0 / .16),0 16px 48px rgb(0 0 0 / .32)}
.fe2ee-dialog::backdrop{background:rgb(0 0 0 / .7)}
.fe2ee-dialog-body{padding:20px 20px 16px;display:flex;flex-direction:column;gap:12px;font-size:15px;line-height:22px}
.fe2ee-dialog h2{margin:0;font-size:20px;line-height:24px;font-weight:600;text-wrap:balance;color:var(--header-primary,#f2f3f5)}
.fe2ee-dialog p{margin:0;text-wrap:pretty;color:var(--text-muted,#b5bac1)}
.fe2ee-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;background:var(--modal-footer-background,var(--background-base-lower,#2b2d31));border-radius:0 0 12px 12px}
.fe2ee-member{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.fe2ee-member + .fe2ee-member{border-top:1px solid var(--border-subtle,rgb(255 255 255 / .06));padding-top:16px}
.fe2ee-member-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.fe2ee-member-name{font-weight:600;color:var(--header-primary,#f2f3f5);overflow-wrap:anywhere}
.fe2ee-status{display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;color:var(--text-muted,#b5bac1)}
.fe2ee-status[data-verified="true"]{color:var(--status-positive,#23a55a)}
.fe2ee-status svg{width:14px;height:14px}
.fe2ee-digits{display:grid;grid-template-columns:repeat(4,auto);justify-content:start;gap:4px 16px;font-size:17px;line-height:24px;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--header-primary,#f2f3f5)}
.fe2ee-member-actions{display:flex;gap:8px;flex-wrap:wrap}
@media (prefers-reduced-motion:no-preference){.fe2ee-banner{animation:fe2ee-in 180ms ease-out}}
@keyframes fe2ee-in{from{opacity:0;translate:0 -6px}}
`;

const svg = (path: string, label?: string) =>
    `<svg viewBox="0 0 24 24" fill="currentColor" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><path fill-rule="evenodd" d="${path}"/></svg>`;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const currentChannel = () => /^\/channels\/@me\/(\d+)/.exec(location.pathname)?.[1] ?? null;

const memberName = (m: ChannelMember) => m.global_name || m.username;

export interface UiOptions {
    engine: Engine;
    states: Map<string, { state: MessageState; reason?: string }>;
    enableChannel: (channelId: string) => Promise<void>;
}

export const createUi = ({ engine, states, enableChannel }: UiOptions) => {
    const style = document.createElement("style");
    style.textContent = css;
    const banners = document.createElement("div");
    banners.className = "fe2ee-banners";
    let failure: string | null = null;
    let transient: { text: string; until: number } | null = null;
    let members: { channelId: string; list: ChannelMember[] } | null = null;
    let scheduled = false;

    const mount = () => {
        if (!style.isConnected) document.head.append(style);
        if (!banners.isConnected && document.body) document.body.append(banners);
    };

    const banner = (id: string, tone: "danger" | "warning" | "info", text: string, action?: { label: string; run: () => void }) => {
        let el = banners.querySelector<HTMLElement>(`[data-id="${id}"]`);
        if (!el) {
            el = document.createElement("div");
            el.className = "fe2ee-banner";
            el.dataset.id = id;
            el.setAttribute("role", tone === "danger" ? "alert" : "status");
            banners.append(el);
        }
        const key = `${tone}|${text}|${action?.label ?? ""}`;
        if (el.dataset.key === key) return;
        el.dataset.key = key;
        el.dataset.tone = tone;
        el.innerHTML = `${svg(LOCK_PATH)}<p>${escape(text)}</p>`;
        if (action) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "fe2ee-button";
            button.textContent = action.label;
            button.addEventListener("click", action.run);
            el.append(button);
        }
    };

    const dropBanner = (id: string) => banners.querySelector(`[data-id="${id}"]`)?.remove();

    const dialog = (title: string, build: (body: HTMLElement, actions: HTMLElement, close: () => void) => void) => {
        const el = document.createElement("dialog");
        el.className = "fe2ee-dialog";
        el.setAttribute("aria-label", title);
        const body = document.createElement("div");
        body.className = "fe2ee-dialog-body";
        body.innerHTML = `<h2>${escape(title)}</h2>`;
        const actions = document.createElement("div");
        actions.className = "fe2ee-dialog-actions";
        el.append(body, actions);
        const close = () => {
            el.close();
            el.remove();
        };
        el.addEventListener("cancel", close);
        build(body, actions, close);
        document.body.append(el);
        el.showModal();
        return el;
    };

    const button = (label: string, variant: "primary" | "secondary", run: () => void) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "fe2ee-button";
        el.dataset.variant = variant;
        el.textContent = label;
        el.addEventListener("click", run);
        return el;
    };

    const confirmEnable = (channelId: string) =>
        dialog("Turn on end-to-end encryption?", (body, actions, close) => {
            body.insertAdjacentHTML(
                "beforeend",
                "<p>New messages in this conversation will be encrypted in your browser before they're sent, and only the people in it can read them. Encryption can't be turned off later.</p><p>Attachments, stickers and polls can't be sent here until encrypted attachments ship.</p>",
            );
            const confirm = button("Turn on encryption", "primary", async () => {
                confirm.disabled = true;
                try {
                    await enableChannel(channelId);
                    close();
                } catch (error) {
                    confirm.disabled = false;
                    showError(error, channelId);
                    close();
                }
            });
            actions.append(button("Cancel", "secondary", close), confirm);
        });

    const showSafety = async (channelId: string) => {
        const list = await Promise.all((await engine.channelMembers(channelId)).map((id) => engine.profile(id)));
        dialog("Safety numbers", (body, actions, close) => {
            body.insertAdjacentHTML(
                "beforeend",
                "<p>Compare these numbers with each person in a call or face to face. If they match, nobody is intercepting your messages. Mark them as verified so you're warned if they change.</p>",
            );
            for (const member of list) {
                const section = document.createElement("section");
                section.className = "fe2ee-member";
                section.innerHTML = `<div class="fe2ee-member-head"><span class="fe2ee-member-name">${escape(memberName(member))}</span><span class="fe2ee-status"></span></div><div class="fe2ee-digits" aria-label="Safety number for ${escape(memberName(member))}">Calculating…</div><div class="fe2ee-member-actions"></div>`;
                body.append(section);
                const render = async () => {
                    const contact = engine.contacts[member.id];
                    const status = section.querySelector<HTMLElement>(".fe2ee-status")!;
                    status.dataset.verified = String(!!contact?.verified && !contact.pendingKey);
                    status.innerHTML = contact?.pendingKey
                        ? `${svg(OPEN_LOCK_PATH)}Safety number changed`
                        : contact?.verified
                          ? `${svg(LOCK_PATH)}Verified`
                          : `${svg(OPEN_LOCK_PATH)}Not verified`;
                    const digits = await engine.safetyNumber(member.id);
                    const grid = section.querySelector<HTMLElement>(".fe2ee-digits")!;
                    grid.innerHTML = digits ? (digits.match(/\d{5}/g) ?? []).map((g) => `<span>${g}</span>`).join("") : "This person hasn't set up encryption yet.";
                    grid.dataset.number = digits ?? "";
                    const row = section.querySelector<HTMLElement>(".fe2ee-member-actions")!;
                    row.replaceChildren();
                    if (!contact) return;
                    if (contact.pendingKey)
                        row.append(
                            button("Accept new safety number", "primary", async () => {
                                await engine.acceptIdentity(member.id);
                                render();
                            }),
                        );
                    else
                        row.append(
                            button(contact.verified ? "Remove verification" : "Mark as verified", contact.verified ? "secondary" : "primary", async () => {
                                await engine.setVerified(member.id, !contact.verified);
                                render();
                            }),
                        );
                };
                render();
            }
            actions.append(button("Close", "secondary", close));
        });
    };

    const showError = (error: unknown, channelId: string) => {
        const name = (id?: string) => (id && members?.channelId === channelId ? (members.list.find((m) => m.id === id) ?? null) : null);
        let text = "Your message couldn't be encrypted, so it wasn't sent.";
        if (error instanceof E2eeError) {
            const who = name(error.userId);
            if (error.code === "NO_DEVICES")
                text = `${who ? memberName(who) : "Someone here"} hasn't set up encryption yet, so your message wasn't sent. Ask them to open the app once.`;
            else if (error.code === "IDENTITY_CHANGED") text = `${who ? memberName(who) : "Someone"}'s safety number changed. Review it before sending more messages.`;
            else if (error.code === "UNSUPPORTED") text = error.message;
            else if (error.code === "NOT_LINKED") text = "This browser isn't linked to your encryption identity yet, so it can't send encrypted messages.";
            else if (error.code === "NOT_READY") text = "End-to-end encryption is unavailable right now, so your message wasn't sent.";
        } else if ((error as { body?: { message?: string } })?.body?.message === "E2EE_RECIPIENT_NO_DEVICES")
            text = "Everyone here needs to open the app once before encryption can be turned on.";
        transient = { text, until: Date.now() + 8000 };
        refresh();
        setTimeout(refresh, 8100);
    };

    const decorateMessages = () => {
        for (const [id, info] of states) {
            const content = document.getElementById(`message-content-${id}`);
            if (!content) continue;
            const existing = content.querySelector<HTMLElement>(":scope > .fe2ee-lock");
            if (existing?.dataset.state === info.state) continue;
            existing?.remove();
            const lock = document.createElement("span");
            lock.className = "fe2ee-lock";
            lock.dataset.state = info.state;
            const label = info.state === "decrypted" ? "End-to-end encrypted" : `Couldn't decrypt: ${info.reason ?? "unknown error"}`;
            lock.title = label;
            lock.innerHTML = svg(info.state === "decrypted" ? LOCK_PATH : OPEN_LOCK_PATH, label);
            content.append(lock);
        }
    };

    const decorateHeader = (channelId: string | null) => {
        const existing = document.querySelector<HTMLButtonElement>(".fe2ee-toggle");
        if (!channelId) return existing?.remove();
        const toolbars = [...document.querySelectorAll<HTMLElement>('[class*="toolbar__"]')];
        const toolbar = toolbars.find((t) => t.parentElement?.className.includes("upperContainer")) ?? toolbars[0];
        if (!toolbar) return;
        const on = engine.isEncrypted(channelId);
        let toggle = existing;
        if (!toggle || toggle.parentElement !== toolbar) {
            toggle?.remove();
            toggle = document.createElement("button");
            toggle.type = "button";
            const sibling = toolbar.querySelector<HTMLElement>('[role="button"]');
            toggle.className = `fe2ee-toggle ${sibling?.className ?? ""}`;
            toggle.addEventListener("click", () => {
                const id = currentChannel();
                if (!id) return;
                if (engine.isEncrypted(id)) showSafety(id);
                else confirmEnable(id);
            });
            toolbar.prepend(toggle);
        }
        const key = String(on);
        if (toggle.dataset.on === key) return;
        toggle.dataset.on = key;
        toggle.setAttribute("aria-pressed", key);
        toggle.setAttribute("aria-label", on ? "End-to-end encryption is on. View safety numbers" : "Turn on end-to-end encryption");
        toggle.title = on ? "End-to-end encrypted" : "Turn on end-to-end encryption";
        toggle.innerHTML = svg(on ? LOCK_PATH : OPEN_LOCK_PATH);
        toggle.querySelector("svg")!.setAttribute("width", "20");
        toggle.querySelector("svg")!.setAttribute("height", "20");
    };

    const decorateBanners = (channelId: string | null) => {
        if (failure) banner("failure", "danger", failure);
        else dropBanner("failure");
        if (transient && transient.until > Date.now()) banner("transient", "warning", transient.text);
        else dropBanner("transient");

        if (channelId && engine.isEncrypted(channelId) && members?.channelId === channelId) {
            const changed = members.list.find((m) => engine.contacts[m.id]?.pendingKey);
            if (changed)
                banner("changed", "warning", `${memberName(changed)}'s safety number changed. Sending is paused until you review it.`, {
                    label: "Review",
                    run: () => showSafety(channelId),
                });
            else dropBanner("changed");
            if (!engine.linked && !failure)
                banner("linked", "warning", "This browser isn't linked to your encryption identity yet, so it can't read or send encrypted messages here.");
            else dropBanner("linked");
        } else {
            dropBanner("changed");
            dropBanner("linked");
        }
    };

    const refresh = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            mount();
            const channelId = currentChannel();
            if (channelId && engine.userId && members?.channelId !== channelId) {
                const id = channelId;
                engine
                    .channelMembers(id)
                    .then((ids) => Promise.all(ids.map((m) => engine.profile(m))))
                    .then((list) => {
                        members = { channelId: id, list };
                        refresh();
                    })
                    .catch(() => {});
            }
            decorateMessages();
            decorateHeader(channelId);
            decorateBanners(channelId);
        });
    };

    const start = () => {
        mount();
        new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
        engine.onChange(refresh);
        refresh();
    };

    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });

    return {
        refresh,
        showError,
        fail: (text: string) => {
            failure = text;
            refresh();
        },
    };
};
