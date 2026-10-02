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

import { generateRecoveryCode } from "./backup";
import { ChannelMember, E2eeError, Engine, ServerDevice } from "./engine";
import { MessageState } from "./hooks";
import { Incoming, Outgoing } from "./link";
import { qrSvg } from "./qr";

const LOCK_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z";
const OPEN_LOCK_PATH = "M9 10h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 9.58-2 1 1 0 1 1-1.83.8A3 3 0 0 0 9 7v3Z";
const VERIFIED_PATH = `${LOCK_PATH}M8.1 15.6l1.4-1.4 1.9 1.9 4.5-4.5 1.4 1.4-5.9 5.9Z`;
const CLOSE_PATH = "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z";
const SCREEN_PATH =
    "M4 3a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H4Zm0 2h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z";

const css = `
.fe2ee-lock{display:inline-flex;vertical-align:-2px;margin-inline-start:4px;color:var(--text-muted,#949ba4)}
.fe2ee-lock svg{width:14px;height:14px}
.fe2ee-lock[data-state="failed"]{color:var(--status-danger,#f23f43)}
.fe2ee-toggle{background:none;border:0;padding:0;margin:0 8px;width:24px;height:24px;flex:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--interactive-icon-default,var(--interactive-normal,#b5bac1));transition:color 120ms ease-out,scale 200ms ease-out}
.fe2ee-toggle svg{width:24px;height:24px}
.fe2ee-toggle[aria-pressed="true"]{color:var(--status-positive,#23a55a)}
.fe2ee-toggle:active{scale:.94}
.fe2ee-toggle:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px;border-radius:4px}
@media (hover:hover){.fe2ee-toggle:hover{color:var(--interactive-icon-hover,var(--interactive-hover,#dbdee1))}.fe2ee-toggle[aria-pressed="true"]:hover{color:var(--status-positive,#23a55a)}}
.fe2ee-tooltip{position:fixed;z-index:10002;pointer-events:none;max-width:220px;padding:8px 12px;border-radius:8px;font-size:14px;line-height:18px;font-weight:500;text-align:center;text-wrap:balance;color:var(--text-strong,#f2f3f5);background:var(--background-surface-highest,#111214);box-shadow:0 0 0 1px var(--border-subtle,rgb(255 255 255 / .06)),0 2px 4px rgb(0 0 0 / .16),0 8px 16px rgb(0 0 0 / .24)}
.fe2ee-tooltip::before{content:"";position:absolute;left:calc(50% - 5px);width:10px;height:10px;rotate:45deg;background:inherit}
.fe2ee-tooltip[data-side="bottom"]::before{top:-4px}
.fe2ee-tooltip[data-side="top"]::before{bottom:-4px}
.fe2ee-notice{display:flex;align-items:center;gap:12px;margin:0 0 8px;padding:8px 8px 8px 12px;min-height:40px;box-sizing:border-box;border-radius:8px;font-size:14px;line-height:18px;color:var(--text-default,#dbdee1);background:var(--background-base-lower,#2b2d31);box-shadow:inset 0 0 0 1px var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-notice svg{flex:none;width:16px;height:16px;color:var(--icon-default,#b5bac1)}
.fe2ee-notice[data-tone="danger"] svg{color:var(--status-danger,#f23f43)}
.fe2ee-notice[data-tone="warning"] svg{color:var(--status-warning,#f0b232)}
.fe2ee-notice p{margin:0;flex:1;min-width:0;text-wrap:pretty}
.fe2ee-notice .fe2ee-button{padding:4px 12px;min-height:28px}
.fe2ee-button{font:inherit;font-size:14px;font-weight:500;line-height:18px;border:0;border-radius:8px;padding:8px 16px;min-height:38px;cursor:pointer;color:#fff;background:var(--control-primary-background-default,var(--button-filled-brand-background,#5865f2));transition:background-color 120ms ease-out,scale 200ms ease-out;white-space:nowrap}
.fe2ee-button[data-variant="secondary"]{color:var(--text-default,#dbdee1);background:var(--control-secondary-background-default,var(--button-secondary-background,#4e5058))}
.fe2ee-button[data-variant="danger"]{color:#fff;background:var(--control-critical-primary-background-default,#da373c)}
.fe2ee-button[data-variant="link"]{padding:0;min-height:0;background:none;color:var(--text-link,#00a8fc);font-weight:400}
.fe2ee-button:disabled{opacity:.5;cursor:not-allowed}
.fe2ee-button:active:not(:disabled){scale:.97}
.fe2ee-button:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px}
@media (hover:hover){.fe2ee-button:hover:not(:disabled){background:var(--control-primary-background-hover,#4752c4)}.fe2ee-button[data-variant="secondary"]:hover:not(:disabled){background:var(--control-secondary-background-hover,#6d6f78)}.fe2ee-button[data-variant="danger"]:hover:not(:disabled){background:var(--control-critical-primary-background-hover,#a12829)}.fe2ee-button[data-variant="link"]:hover:not(:disabled){background:none;text-decoration:underline}}
.fe2ee-dialog{border:0;padding:0;border-radius:12px;width:min(480px,calc(100vw - 32px));max-height:min(720px,calc(100dvh - 64px));overflow:hidden;color:var(--text-default,#dbdee1);background:var(--modal-background,var(--background-base-low,#313338));box-shadow:0 0 0 1px var(--border-subtle,rgb(255 255 255 / .06)),0 4px 8px rgb(0 0 0 / .16),0 16px 48px rgb(0 0 0 / .32)}
.fe2ee-dialog[open]{display:flex;flex-direction:column}
.fe2ee-dialog::backdrop{background:rgb(0 0 0 / .7)}
.fe2ee-dialog-head{flex:none;display:flex;align-items:flex-start;gap:16px;padding:20px 16px 4px 20px}
.fe2ee-dialog h2{flex:1;margin:0;font-size:20px;line-height:24px;font-weight:600;text-wrap:balance;color:var(--text-strong,#f2f3f5)}
.fe2ee-close{flex:none;width:32px;height:32px;margin:-4px 0 0;padding:0;display:grid;place-items:center;border:0;border-radius:8px;background:none;color:var(--interactive-icon-default,#b5bac1);cursor:pointer;transition:color 120ms ease-out,background-color 120ms ease-out}
.fe2ee-close svg{width:24px;height:24px}
.fe2ee-close[hidden]{display:none}
.fe2ee-close:focus-visible{outline:2px solid var(--focus-primary,#00a8fc)}
@media (hover:hover){.fe2ee-close:hover{color:var(--interactive-icon-hover,#dbdee1);background:var(--background-mod-subtle,rgb(255 255 255 / .06))}}
.fe2ee-dialog-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:8px 20px 20px;display:flex;flex-direction:column;gap:12px;font-size:15px;line-height:22px}
.fe2ee-dialog p,.fe2ee-page p{margin:0;text-wrap:pretty;color:var(--text-muted,#b5bac1)}
.fe2ee-dialog-actions{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;background:var(--modal-footer-background,var(--background-base-lower,#2b2d31));box-shadow:0 -1px 0 var(--border-subtle,rgb(255 255 255 / .06))}
@media (prefers-reduced-motion:no-preference){.fe2ee-dialog[open]{animation:fe2ee-modal-in 260ms cubic-bezier(.2,.9,.3,1.05)}.fe2ee-dialog[open]::backdrop{animation:fe2ee-fade 200ms ease-out}.fe2ee-dialog[data-closing]{animation:fe2ee-modal-out 150ms ease-in forwards}.fe2ee-dialog[data-closing]::backdrop{animation:fe2ee-fade 150ms ease-in reverse forwards}.fe2ee-tooltip{animation:fe2ee-fade 120ms ease-out}}
@keyframes fe2ee-modal-in{from{opacity:0;scale:.9}}
@keyframes fe2ee-modal-out{to{opacity:0;scale:.9}}
@keyframes fe2ee-fade{from{opacity:0}}
.fe2ee-member{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.fe2ee-member + .fe2ee-member{border-top:1px solid var(--border-subtle,rgb(255 255 255 / .06));padding-top:16px}
.fe2ee-member-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.fe2ee-member-name{font-weight:600;color:var(--text-strong,#f2f3f5);overflow-wrap:anywhere}
.fe2ee-status{display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;color:var(--text-muted,#b5bac1)}
.fe2ee-status[data-verified="true"]{color:var(--status-positive,#23a55a)}
.fe2ee-status svg{width:14px;height:14px}
.fe2ee-safety{display:flex;gap:16px;align-items:center}
.fe2ee-digits{flex:1;display:grid;grid-template-columns:repeat(4,auto);justify-content:start;gap:4px 16px;font-size:17px;line-height:24px;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--text-strong,#f2f3f5)}
.fe2ee-qr{flex:none;width:112px;height:112px;border-radius:8px;overflow:hidden;background:#fff}
.fe2ee-qr svg{display:block;width:100%;height:100%}
@media (max-width:480px){.fe2ee-safety{flex-direction:column;align-items:flex-start}}
.fe2ee-member-actions{display:flex;gap:8px;flex-wrap:wrap}
.fe2ee-unlock{font:inherit;font-size:13px;font-weight:500;line-height:18px;margin-inline-start:8px;padding:2px 8px;border:0;border-radius:4px;cursor:pointer;color:var(--text-default,#dbdee1);background:var(--control-secondary-background-default,#4e5058);transition:background-color 120ms ease-out,scale 200ms ease-out}
.fe2ee-unlock:active{scale:.97}
.fe2ee-unlock:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px}
@media (hover:hover){.fe2ee-unlock:hover{background:var(--control-secondary-background-hover,#6d6f78)}}
.fe2ee-section{display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:1px solid var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-section h3{margin:0;font-size:16px;line-height:20px;font-weight:600;color:var(--text-strong,#f2f3f5)}
.fe2ee-section > .fe2ee-button{align-self:flex-start}
.fe2ee-field{display:flex;flex-direction:column;gap:8px}
.fe2ee-field label{font-size:14px;font-weight:500;color:var(--text-default,#dbdee1)}
.fe2ee-row{display:flex;gap:8px;align-items:center}
.fe2ee-input{flex:1;min-width:0;font:inherit;font-size:16px;line-height:20px;padding:9px 12px;border-radius:8px;border:0;color:var(--text-default,#dbdee1);background:var(--input-background-default,var(--background-base-lowest,#1e1f22));box-shadow:inset 0 0 0 1px var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-input:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:-1px}
.fe2ee-input[aria-invalid="true"]{box-shadow:inset 0 0 0 1px var(--status-danger,#f23f43)}
.fe2ee-dialog .fe2ee-error,.fe2ee-page .fe2ee-error{margin:0;font-size:14px;line-height:18px;color:var(--text-feedback-critical,var(--status-danger,#f23f43))}
.fe2ee-code{font-size:28px;line-height:36px;font-weight:600;letter-spacing:.08em;font-variant-numeric:tabular-nums;color:var(--text-strong,#f2f3f5)}
.fe2ee-recovery{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0;padding:12px;list-style:none;border-radius:8px;background:var(--background-base-lowest,#1e1f22)}
.fe2ee-recovery li{font-family:var(--font-code,ui-monospace,monospace);font-size:16px;line-height:24px;font-weight:600;text-align:center;letter-spacing:.06em;color:var(--text-strong,#f2f3f5)}
.fe2ee-devices{display:flex;flex-direction:column;border-radius:8px;background:var(--card-background-default,var(--background-base-lower,#2b2d31));box-shadow:inset 0 0 0 1px var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-device{display:flex;align-items:center;gap:12px;padding:12px 16px}
.fe2ee-device + .fe2ee-device{border-top:1px solid var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-device-icon{flex:none;width:40px;height:40px;display:grid;place-items:center;border-radius:50%;color:var(--icon-default,#b5bac1);background:var(--background-mod-subtle,rgb(255 255 255 / .06))}
.fe2ee-device-icon svg{width:20px;height:20px}
.fe2ee-device-text{flex:1;min-width:0;display:flex;flex-direction:column}
.fe2ee-device-name{font-size:15px;line-height:20px;font-weight:600;color:var(--text-strong,#f2f3f5);overflow-wrap:anywhere}
.fe2ee-device-meta{font-size:13px;line-height:18px;color:var(--text-muted,#b5bac1);overflow-wrap:anywhere}
.fe2ee-device-meta[data-current="true"]{color:var(--text-feedback-positive,var(--status-positive,#23a55a))}
.fe2ee-page{display:flex;flex-direction:column;gap:24px;font-size:15px;line-height:22px;color:var(--text-default,#dbdee1);padding-bottom:40px}
.fe2ee-page .fe2ee-section{border-top:0;padding-top:0}
.fe2ee-page .fe2ee-section h3{font-size:18px;line-height:22px}
`;

const svg = (path: string, label?: string) =>
    `<svg viewBox="0 0 24 24" fill="currentColor" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><path fill-rule="evenodd" d="${path}"/></svg>`;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const currentChannel = () => /^\/channels\/@me\/(\d+)/.exec(location.pathname)?.[1] ?? null;

const memberName = (m: ChannelMember) => m.global_name || m.username;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const ago = (iso: string) => {
    const seconds = (Date.parse(iso) - Date.now()) / 1000;
    const steps: [number, Intl.RelativeTimeFormatUnit][] = [
        [60, "second"],
        [60, "minute"],
        [24, "hour"],
        [30, "day"],
        [12, "month"],
        [Infinity, "year"],
    ];
    let value = seconds;
    for (const [size, unit] of steps) {
        if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
        value /= size;
    }
    return "";
};

type Notice = { tone: "danger" | "warning" | "info"; text: string; action?: { label: string; run: () => void } };

const UNLOCK_SNOOZE_KEY = "fe2ee-unlock-snoozed-until";
const UNLOCK_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const unlockSnoozed = () => {
    try {
        return Number(localStorage.getItem(UNLOCK_SNOOZE_KEY)) > Date.now();
    } catch {
        return false;
    }
};

const snoozeUnlock = () => {
    try {
        localStorage.setItem(UNLOCK_SNOOZE_KEY, String(Date.now() + UNLOCK_SNOOZE_MS));
    } catch {
        return;
    }
};

export interface UiOptions {
    engine: Engine;
    states: Map<string, { state: MessageState; reason?: string }>;
    enableChannel: (channelId: string) => Promise<void>;
    link: { outgoing: () => Outgoing | null; request: () => Promise<void>; cancel: () => Promise<void> };
    verifyPassword: (password: string) => Promise<boolean>;
    reset: (password: string) => Promise<void>;
}

export const createUi = ({ engine, states, enableChannel, link, verifyPassword, reset }: UiOptions) => {
    const style = document.createElement("style");
    style.textContent = css;
    const bar = document.createElement("div");
    bar.className = "fe2ee-notice";
    bar.setAttribute("role", "status");
    let failure: string | null = null;
    let transient: (Notice & { channelId: string; until: number }) | null = null;
    let transientTimer: ReturnType<typeof setTimeout> | null = null;
    let unlockOpen: { render: () => void; close: () => void } | null = null;
    const approvals = new Map<string, () => void>();
    let members: { channelId: string; list: ChannelMember[] } | null = null;
    let scheduled = false;
    let tooltip: HTMLElement | null = null;

    const mount = () => {
        if (!style.isConnected) document.head.append(style);
    };

    const flash = (channelId: string, notice: Notice, ms = 8000) => {
        transient = { ...notice, channelId, until: Date.now() + ms };
        if (transientTimer) clearTimeout(transientTimer);
        transientTimer = setTimeout(refresh, ms + 50);
        refresh();
    };

    const hideTooltip = () => {
        tooltip?.remove();
        tooltip = null;
    };

    const showTooltip = (anchor: HTMLElement, text: string) => {
        hideTooltip();
        const el = document.createElement("div");
        el.className = "fe2ee-tooltip";
        el.setAttribute("role", "tooltip");
        el.textContent = text;
        document.body.append(el);
        const box = anchor.getBoundingClientRect();
        const below = box.bottom + 8 + el.offsetHeight < innerHeight;
        el.dataset.side = below ? "bottom" : "top";
        el.style.top = `${below ? box.bottom + 8 : box.top - 8 - el.offsetHeight}px`;
        el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, box.left + box.width / 2 - el.offsetWidth / 2))}px`;
        tooltip = el;
    };

    const withTooltip = (el: HTMLElement, text: () => string) => {
        const show = () => showTooltip(el, text());
        el.addEventListener("mouseenter", show);
        el.addEventListener("focus", show);
        el.addEventListener("mouseleave", hideTooltip);
        el.addEventListener("blur", hideTooltip);
        el.addEventListener("click", hideTooltip);
    };

    const button = (label: string, variant: "primary" | "secondary" | "danger" | "link", run: () => void) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "fe2ee-button";
        el.dataset.variant = variant;
        el.textContent = label;
        el.addEventListener("click", run);
        return el;
    };

    interface DialogHandle {
        el: HTMLDialogElement;
        close: () => void;
        setDismissable: (value: boolean) => void;
    }

    const dialog = (title: string, build: (body: HTMLElement, actions: HTMLElement, handle: DialogHandle) => void) => {
        const el = document.createElement("dialog");
        el.className = "fe2ee-dialog";
        el.setAttribute("aria-label", title);
        const head = document.createElement("div");
        head.className = "fe2ee-dialog-head";
        head.innerHTML = `<h2>${escape(title)}</h2>`;
        const x = document.createElement("button");
        x.type = "button";
        x.className = "fe2ee-close";
        x.setAttribute("aria-label", "Close");
        x.innerHTML = svg(CLOSE_PATH);
        head.append(x);
        const body = document.createElement("div");
        body.className = "fe2ee-dialog-body";
        const actions = document.createElement("div");
        actions.className = "fe2ee-dialog-actions";
        el.append(head, body, actions);
        let dismissable = true;
        let closing = false;
        const close = () => {
            if (closing || !el.isConnected) return;
            closing = true;
            const finish = () => {
                el.close();
                el.remove();
            };
            if (reducedMotion()) return finish();
            el.dataset.closing = "";
            el.addEventListener("animationend", finish, { once: true });
            setTimeout(finish, 250);
        };
        const handle: DialogHandle = {
            el,
            close,
            setDismissable: (value) => {
                dismissable = value;
                x.hidden = !value;
            },
        };
        x.addEventListener("click", close);
        el.addEventListener("cancel", (event) => {
            event.preventDefault();
            if (dismissable) close();
        });
        el.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (dismissable) close();
        });
        let pressedBackdrop = false;
        el.addEventListener("pointerdown", (event) => {
            pressedBackdrop = event.target === el;
        });
        el.addEventListener("click", (event) => {
            if (event.target === el && pressedBackdrop && dismissable) close();
            pressedBackdrop = false;
        });
        build(body, actions, handle);
        document.body.append(el);
        el.showModal();
        return handle;
    };

    const field = (labelText: string, type: "password" | "text", autocomplete: AutoFill) => {
        const id = `fe2ee-${Math.random().toString(36).slice(2)}`;
        const wrap = document.createElement("div");
        wrap.className = "fe2ee-field";
        wrap.innerHTML = `<label for="${id}">${escape(labelText)}</label><div class="fe2ee-row"></div><p class="fe2ee-error" id="${id}-error" role="alert" hidden></p>`;
        const input = document.createElement("input");
        input.className = "fe2ee-input";
        input.id = id;
        input.type = type;
        input.autocomplete = autocomplete;
        input.spellcheck = false;
        input.setAttribute("aria-describedby", `${id}-error`);
        const row = wrap.querySelector<HTMLElement>(".fe2ee-row")!;
        row.append(input);
        const error = wrap.querySelector<HTMLElement>(".fe2ee-error")!;
        const setError = (text: string | null) => {
            error.hidden = !text;
            error.textContent = text ?? "";
            input.setAttribute("aria-invalid", String(!!text));
            if (text) input.focus();
        };
        return { wrap, input, row, setError };
    };

    const section = (title: string, text?: string) => {
        const el = document.createElement("section");
        el.className = "fe2ee-section";
        el.innerHTML = `<h3>${escape(title)}</h3>${text ? `<p>${escape(text)}</p>` : ""}`;
        return el;
    };

    const describe = (el: HTMLElement, text: string) => {
        const p = document.createElement("p");
        p.textContent = text;
        el.append(p);
        return p;
    };

    const namesOf = async (ids: string[]) => {
        const list = await Promise.all(ids.map((id) => engine.profile(id)));
        const names = list.map(memberName);
        if (names.length <= 1) return names[0] ?? "Someone here";
        return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    };

    const showError = (error: unknown, channelId: string) => {
        const name = (id?: string) => (id && members?.channelId === channelId ? (members.list.find((m) => m.id === id) ?? null) : null);
        const body = (error as { body?: { message?: string; user_ids?: unknown } })?.body;
        if (body?.message === "E2EE_RECIPIENT_NO_DEVICES") {
            const ids = Array.isArray(body.user_ids) ? body.user_ids.map(String) : [];
            namesOf(ids).then((who) =>
                flash(channelId, {
                    tone: "warning",
                    text: `${who} ${ids.length > 1 ? "haven't" : "hasn't"} set up encryption yet. Ask them to open the app once, then try again.`,
                }),
            );
            return;
        }
        let text = "Your message couldn't be encrypted, so it wasn't sent.";
        let action: Notice["action"];
        if (error instanceof E2eeError) {
            const who = name(error.userId);
            if (error.code === "NO_DEVICES")
                text = `${who ? memberName(who) : "Someone here"} hasn't set up encryption yet, so your message wasn't sent. Ask them to open the app once.`;
            else if (error.code === "IDENTITY_CHANGED") text = `${who ? memberName(who) : "Someone"}'s safety number changed. Review it before sending more messages.`;
            else if (error.code === "UNSUPPORTED") text = "Files, stickers and polls can't be sent in encrypted conversations yet.";
            else if (error.code === "NOT_LINKED") {
                text = "Unlock this browser to send encrypted messages. Your message wasn't sent.";
                action = { label: "Unlock", run: showUnlock };
            } else if (error.code === "NOT_READY") text = "End-to-end encryption is unavailable right now, so your message wasn't sent.";
        }
        flash(channelId, { tone: "danger", text, action });
    };

    const confirmEnable = (channelId: string) =>
        dialog("Turn on end-to-end encryption?", (body, actions, { close }) => {
            body.insertAdjacentHTML(
                "beforeend",
                "<p>New messages in this conversation are encrypted in your browser before they're sent, and only the people in it can read them. Encryption can't be turned off later.</p><p>Files, stickers and polls can't be sent here until encrypted attachments ship.</p>",
            );
            const confirm = button("Turn on encryption", "primary", async () => {
                confirm.disabled = true;
                try {
                    await enableChannel(channelId);
                } catch (error) {
                    showError(error, channelId);
                }
                close();
            });
            actions.append(button("Cancel", "secondary", close), confirm);
        });

    const showSafety = async (channelId: string) => {
        const list = await Promise.all((await engine.channelMembers(channelId)).map((id) => engine.profile(id)));
        dialog("Safety numbers", (body, actions, { close }) => {
            body.insertAdjacentHTML(
                "beforeend",
                "<p>Compare these numbers with each person in a call or face to face, or scan the code with their phone. If they match, nobody is intercepting your messages. Mark them as verified so you're warned if they change.</p>",
            );
            for (const member of list) {
                const block = document.createElement("section");
                block.className = "fe2ee-member";
                block.innerHTML = `<div class="fe2ee-member-head"><span class="fe2ee-member-name">${escape(memberName(member))}</span><span class="fe2ee-status"></span></div><div class="fe2ee-safety"><div class="fe2ee-digits" aria-label="Safety number for ${escape(memberName(member))}">Calculating…</div></div><div class="fe2ee-member-actions"></div>`;
                body.append(block);
                const render = async () => {
                    const contact = engine.contacts[member.id];
                    const status = block.querySelector<HTMLElement>(".fe2ee-status")!;
                    status.dataset.verified = String(!!contact?.verified && !contact.pendingKey);
                    status.innerHTML = contact?.pendingKey
                        ? `${svg(OPEN_LOCK_PATH)}Safety number changed`
                        : contact?.verified
                          ? `${svg(VERIFIED_PATH)}Verified`
                          : `${svg(OPEN_LOCK_PATH)}Not verified`;
                    const digits = await engine.safetyNumber(member.id);
                    const grid = block.querySelector<HTMLElement>(".fe2ee-digits")!;
                    grid.innerHTML = digits ? (digits.match(/\d{5}/g) ?? []).map((g) => `<span>${g}</span>`).join("") : "This person hasn't set up encryption yet.";
                    grid.dataset.number = digits ?? "";
                    block.querySelector(".fe2ee-qr")?.remove();
                    if (digits) {
                        const qr = document.createElement("div");
                        qr.className = "fe2ee-qr";
                        qr.innerHTML = qrSvg(digits, `QR code of the safety number for ${escape(memberName(member))}`);
                        grid.after(qr);
                    }
                    const row = block.querySelector<HTMLElement>(".fe2ee-member-actions")!;
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
            actions.append(
                button("Encryption settings", "secondary", () => {
                    close();
                    showSettings();
                }),
                button("Done", "primary", close),
            );
        });
    };

    const showReset = (onDone?: () => void) =>
        dialog("Reset encryption?", (body, actions, { close }) => {
            describe(
                body,
                "Only do this if you lost your recovery code and no other signed-in browser can approve this one. You get new encryption keys and can keep chatting, but nobody can read the messages sent before the reset anymore, on any device.",
            );
            describe(body, "Your other browsers have to be approved again, and the people you talk to are told that your safety number changed.");
            const { wrap, input, setError } = field("Account password", "password", "current-password");
            body.append(wrap);
            const confirm = button("Reset encryption", "danger", async () => {
                if (!input.value) return setError("Enter your password.");
                confirm.disabled = true;
                setError(null);
                try {
                    await reset(input.value);
                    close();
                    onDone?.();
                    const channelId = currentChannel();
                    if (channelId) flash(channelId, { tone: "info", text: "Encryption was reset. New messages use your new keys." }, 6000);
                } catch (error) {
                    const status = (error as { status?: number })?.status;
                    setError(status === 400 ? "That password isn't right." : error instanceof Error ? error.message : "Couldn't reset encryption. Try again.");
                } finally {
                    confirm.disabled = false;
                }
            });
            input.addEventListener("keydown", (event) => event.key === "Enter" && confirm.click());
            actions.append(button("Cancel", "secondary", close), confirm);
            requestAnimationFrame(() => input.focus());
        });

    const unlockForm = (kind: "password" | "recovery") => {
        const { wrap, input, row, setError } = kind === "password" ? field("Account password", "password", "current-password") : field("Recovery code", "text", "off");
        if (kind === "recovery") input.placeholder = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
        const submit = button("Unlock", "primary", async () => {
            if (!input.value.trim()) return setError(kind === "password" ? "Enter your password." : "Enter your recovery code.");
            submit.disabled = true;
            setError(null);
            try {
                await engine.unlockWith(kind, input.value.trim());
            } catch (error) {
                setError(error instanceof Error ? error.message : String(error));
            } finally {
                submit.disabled = false;
            }
        });
        input.addEventListener("keydown", (event) => event.key === "Enter" && submit.click());
        row.append(submit);
        return wrap;
    };

    const showUnlock = () => {
        if (unlockOpen || !engine.locked) return;
        const current = link.outgoing();
        if (!current || current.state === "denied" || current.state === "failed") link.request().catch(() => {});
        dialog("Unlock encrypted messages", (body, actions, { el, close }) => {
            const backup = engine.backup;
            describe(body, "This browser can't read your encrypted messages yet. Bring your keys over with one of these.");
            if (backup?.wrapped_secret && backup.identity_key === engine.serverKey) {
                const own = section(
                    backup.mode === "recovery" ? "Enter your recovery code" : "Enter your password",
                    backup.mode === "recovery" ? "Use the code you saved when you switched to a recovery code." : undefined,
                );
                own.append(unlockForm(backup.mode));
                body.append(own);
            }
            const approval = section("Approve from another device");
            const status = document.createElement("p");
            status.setAttribute("role", "status");
            const code = document.createElement("div");
            code.className = "fe2ee-code";
            const again = button("Ask for approval", "secondary", () => link.request().catch(() => {}));
            approval.append(status, code, again);
            body.append(approval);
            const lost = section(backup?.mode === "recovery" ? "Lost your code?" : "Can't unlock this browser?");
            describe(lost, "If you can't use any of these, reset encryption to keep chatting. Messages sent before the reset can't be read anymore.");
            lost.append(button("Reset encryption", "link", () => showReset(done)));
            body.append(lost);
            const render = () => {
                const state = link.outgoing();
                code.hidden = state?.state !== "comparing";
                code.textContent = state?.sas ?? "";
                again.hidden = state?.state === "waiting" || state?.state === "comparing" || state?.state === "done";
                again.textContent = state ? "Ask again" : "Ask for approval";
                status.textContent =
                    state?.state === "comparing"
                        ? `${state.approverName ?? "Your other device"} is asking you to approve this browser. Check that it shows this code, then approve it there.`
                        : state?.state === "denied"
                          ? "Your other device declined this login."
                          : state?.state === "failed"
                            ? "The approval didn't unlock this browser. Ask again to retry."
                            : state?.state === "waiting"
                              ? "Open the app on a browser where you're already signed in. It asks you to approve this one."
                              : "Ask a browser where you're already signed in to approve this one.";
                if (engine.linked) {
                    done();
                    const channelId = currentChannel();
                    if (channelId) flash(channelId, { tone: "info", text: "This browser is unlocked. Your encrypted messages are loading." }, 5000);
                }
            };
            const stop = engine.onChange(render);
            const done = () => {
                stop();
                unlockOpen = null;
                close();
            };
            unlockOpen = { render, close: done };
            el.addEventListener("close", () => {
                stop();
                unlockOpen = null;
                if (engine.locked) snoozeUnlock();
            });
            actions.append(
                button("Not now", "secondary", () => {
                    link.cancel().catch(() => {});
                    done();
                }),
            );
            render();
        });
    };

    const showApproval = (prompt: Incoming) => {
        if (approvals.has(prompt.requestId)) return;
        dialog(`New login on ${prompt.name}`, (body, actions, { el, close }) => {
            body.insertAdjacentHTML(
                "beforeend",
                `<p>Approve it only if you just signed in there yourself, because it gets access to your encrypted messages. The other browser should show this code:</p><div class="fe2ee-code">${escape(prompt.sas)}</div>`,
            );
            const error = document.createElement("p");
            error.className = "fe2ee-error";
            error.setAttribute("role", "alert");
            error.hidden = true;
            body.append(error);
            const finish = () => {
                approvals.delete(prompt.requestId);
                close();
            };
            approvals.set(prompt.requestId, finish);
            el.addEventListener("close", () => approvals.delete(prompt.requestId));
            const run = async (action: () => Promise<void>) => {
                approve.disabled = deny.disabled = true;
                error.hidden = true;
                try {
                    await action();
                    finish();
                } catch (failure) {
                    error.textContent = `Couldn't answer that login: ${failure instanceof Error ? failure.message : String(failure)}`;
                    error.hidden = false;
                    approve.disabled = deny.disabled = false;
                }
            };
            const approve = button("Approve login", "primary", () => run(prompt.approve));
            const deny = button("Deny", "secondary", () => run(prompt.deny));
            actions.append(deny, approve);
        });
    };

    const dismissApproval = (requestId: string) => approvals.get(requestId)?.();

    const showRecoveryCode = () =>
        dialog("Use a recovery code", (body, actions, { close, setDismissable }) => {
            const intro = describe(
                body,
                "We'll make a code that locks your key backup instead of your password. You'll need it to set up a new browser when no other device is around to approve it. We only show it once.",
            );
            const code = generateRecoveryCode();
            const create = button("Make recovery code", "primary", () => {
                setDismissable(false);
                intro.textContent =
                    "Save this code somewhere safe, like a password manager. Anyone with it and access to your account can read your encrypted messages. It replaces your password lock once you confirm.";
                const grid = document.createElement("ol");
                grid.className = "fe2ee-recovery";
                grid.dataset.code = code;
                grid.setAttribute("aria-label", "Recovery code");
                grid.innerHTML = code
                    .split("-")
                    .map((group) => `<li>${escape(group)}</li>`)
                    .join("");
                const error = document.createElement("p");
                error.className = "fe2ee-error";
                error.setAttribute("role", "alert");
                error.hidden = true;
                body.append(grid, error);
                let copiedTimer: ReturnType<typeof setTimeout> | null = null;
                const copy = button("Copy code", "secondary", () => {
                    navigator.clipboard
                        ?.writeText(code)
                        .then(() => {
                            copy.textContent = "Copied!";
                            if (copiedTimer) clearTimeout(copiedTimer);
                            copiedTimer = setTimeout(() => (copy.textContent = "Copy code"), 2000);
                        })
                        .catch(() => {
                            copy.textContent = "Couldn't copy";
                        });
                });
                const saved = button("I saved it", "primary", async () => {
                    saved.disabled = true;
                    error.hidden = true;
                    try {
                        await engine.setBackupMode("recovery", code);
                        close();
                    } catch (failure) {
                        error.textContent = `Couldn't switch to the recovery code: ${failure instanceof Error ? failure.message : String(failure)}`;
                        error.hidden = false;
                        saved.disabled = false;
                    }
                });
                actions.replaceChildren(button("Cancel", "secondary", close), copy, saved);
            });
            actions.append(button("Cancel", "secondary", close), create);
        });

    const deviceMeta = (device: ServerDevice) => {
        const current = device.device_id === engine.device?.deviceId;
        const session = device.session;
        const state = current
            ? "This browser"
            : device.status === "pending"
              ? "Waiting for approval"
              : session && !session.signed_in
                ? "Signed out"
                : session?.last_seen && Date.now() - Date.parse(session.last_seen) < 5 * 60 * 1000
                  ? "Active now"
                  : session?.last_seen
                    ? `Last active ${ago(session.last_seen)}`
                    : "Can read encrypted messages";
        const added = device.created_at
            ? `Added ${new Date(device.created_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`
            : null;
        return { current, text: [state, session?.location, added].filter(Boolean).join(" · ") };
    };

    const confirmRemove = (device: ServerDevice, onDone: () => void) =>
        dialog("Remove this device?", (body, actions, { close }) => {
            describe(
                body,
                `${device.name ?? "This browser"} is signed out and can't read new encrypted messages. To read them there again, it needs your recovery code, your password, or approval from another device.`,
            );
            const error = document.createElement("p");
            error.className = "fe2ee-error";
            error.setAttribute("role", "alert");
            error.hidden = true;
            body.append(error);
            const confirm = button("Remove device", "danger", async () => {
                confirm.disabled = true;
                try {
                    await engine.removeDevice(device.device_id);
                    close();
                    onDone();
                } catch (failure) {
                    error.textContent = `Couldn't remove it: ${failure instanceof Error ? failure.message : String(failure)}`;
                    error.hidden = false;
                    confirm.disabled = false;
                }
            });
            actions.append(button("Cancel", "secondary", close), confirm);
        });

    const buildSettings = (root: HTMLElement, close?: () => void) => {
        const browser = section("This browser");
        const backupSection = section("Key backup");
        const devices = section("Your devices", "Every browser listed here can read your encrypted messages. Remove the ones you don't recognize or don't use anymore.");
        const resetSection = section(
            "Reset encryption",
            "If you lost your recovery code and no other browser can approve a new one, reset encryption to keep chatting. Messages sent before the reset can't be read anymore.",
        );
        const list = document.createElement("div");
        list.className = "fe2ee-devices";
        devices.append(list);
        resetSection.append(button("Reset encryption", "danger", () => showReset()));
        root.append(browser, backupSection, devices, resetSection);
        const clear = (el: HTMLElement) => el.querySelectorAll(":scope > :not(h3)").forEach((child) => child.remove());
        const renderBrowser = () => {
            clear(browser);
            describe(browser, engine.linked ? "Unlocked. This browser can read and send encrypted messages." : "Locked. This browser can't read encrypted messages yet.");
            if (!engine.linked)
                browser.append(
                    button("Unlock this browser", "primary", () => {
                        close?.();
                        showUnlock();
                    }),
                );
        };
        let backupKey = "";
        const renderBackup = (force = false) => {
            const backup = engine.backup;
            const key = `${backup?.mode}|${backup?.version}|${!!backup?.wrapped_secret}|${engine.hasSecret}`;
            if (!force && key === backupKey) return;
            backupKey = key;
            clear(backupSection);
            backupSection.dataset.mode = backup?.mode ?? "none";
            if (!backup) return void describe(backupSection, "Your keys aren't backed up yet. Sign in on a browser that can read your messages to create the backup.");
            if (backup.mode === "recovery")
                describe(backupSection, "Your keys are backed up and locked with a recovery code. New browsers ask for that code, and your password can't unlock them.");
            else if (backup.wrapped_secret)
                describe(
                    backupSection,
                    "Your keys are backed up and locked with your account password, so new browsers unlock as soon as you sign in. Someone with a copy of the server's database could try to guess a weak password offline.",
                );
            else describe(backupSection, "Your keys are backed up. The password lock gets added the next time you sign in.");
            if (!engine.hasSecret) return;
            if (backup.mode === "password") {
                backupSection.append(
                    button("Use a recovery code instead", "secondary", () => {
                        close?.();
                        showRecoveryCode();
                    }),
                );
                return;
            }
            const { wrap, input, row, setError } = field("Account password", "password", "current-password");
            const save = button("Use my password instead", "secondary", async () => {
                if (!input.value) return setError("Enter your password.");
                save.disabled = true;
                setError(null);
                try {
                    if (!(await verifyPassword(input.value))) return setError("That password isn't right.");
                    await engine.setBackupMode("password", input.value);
                    renderBackup(true);
                } catch (error) {
                    setError(error instanceof Error ? error.message : String(error));
                } finally {
                    save.disabled = false;
                }
            });
            input.addEventListener("keydown", (event) => event.key === "Enter" && save.click());
            row.append(save);
            backupSection.append(
                wrap,
                button("Make a new recovery code", "secondary", () => {
                    close?.();
                    showRecoveryCode();
                }),
            );
        };
        const renderDevices = () => {
            list.replaceChildren();
            const active = engine.devices
                .filter((d) => d.status !== "revoked")
                .sort(
                    (a, b) =>
                        Number(b.device_id === engine.device?.deviceId) - Number(a.device_id === engine.device?.deviceId) ||
                        Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""),
                );
            for (const device of active) {
                const row = document.createElement("div");
                row.className = "fe2ee-device";
                const { current, text } = deviceMeta(device);
                row.innerHTML = `<div class="fe2ee-device-icon">${svg(SCREEN_PATH)}</div><div class="fe2ee-device-text"><span class="fe2ee-device-name">${escape(device.name ?? "Unknown browser")}</span><span class="fe2ee-device-meta" data-current="${current}">${escape(text)}</span></div>`;
                if (!current) row.append(button("Remove", "secondary", () => confirmRemove(device, renderDevices)));
                list.append(row);
            }
        };
        const render = () => {
            renderBrowser();
            renderBackup();
            renderDevices();
        };
        render();
        engine.reloadBackup().then(
            () => renderBackup(true),
            () => {},
        );
        engine.refresh().catch(() => {});
        return engine.onChange(render);
    };

    const showSettings = () =>
        dialog("Encryption settings", (body, actions, { el, close }) => {
            const stop = buildSettings(body, close);
            el.addEventListener("close", () => stop());
            actions.append(button("Done", "primary", close));
        });

    const mountSettings = (container: HTMLElement) => {
        mount();
        const root = document.createElement("div");
        root.className = "fe2ee-page";
        container.replaceChildren(root);
        if (!engine.userId) {
            describe(root, failure ?? "Encryption is still starting up.");
            return () => {};
        }
        const stop = buildSettings(root);
        return () => {
            stop();
            root.remove();
        };
    };

    const beforeSend = (channelId: string, extras: { hasAttachments?: boolean; hasStickers?: boolean }) => {
        if (!engine.isEncrypted(channelId)) return false;
        if (failure) {
            flash(channelId, { tone: "danger", text: failure });
            return true;
        }
        if (extras.hasAttachments || extras.hasStickers) {
            flash(channelId, { tone: "warning", text: "Files and stickers can't be sent in encrypted conversations yet. Remove them to send your message." });
            return true;
        }
        const changed = members?.channelId === channelId ? members.list.find((m) => engine.contacts[m.id]?.pendingKey) : undefined;
        if (changed) {
            flash(channelId, {
                tone: "warning",
                text: `${memberName(changed)}'s safety number changed. Review it before sending. Your message is still in the text box.`,
                action: { label: "Review", run: () => showSafety(channelId) },
            });
            return true;
        }
        if (engine.locked) {
            showUnlock();
            flash(channelId, {
                tone: "warning",
                text: "Unlock this browser to send encrypted messages. Your message is still in the text box.",
                action: { label: "Unlock", run: showUnlock },
            });
            return true;
        }
        return false;
    };

    const decorateMessages = () => {
        for (const [id, info] of states) {
            const content = document.getElementById(`message-content-${id}`);
            if (!content) continue;
            const existing = content.querySelector<HTMLElement>(":scope > .fe2ee-lock");
            const trailing = existing ? [...content.children].slice([...content.children].indexOf(existing) + 1).every((el) => el.classList.contains("fe2ee-unlock")) : false;
            if (existing?.dataset.state === info.state && trailing) continue;
            existing?.remove();
            content.querySelector(":scope > .fe2ee-unlock")?.remove();
            const lock = document.createElement("span");
            lock.className = "fe2ee-lock";
            lock.dataset.state = info.state;
            const label =
                info.state === "decrypted"
                    ? "End-to-end encrypted"
                    : info.state === "pending"
                      ? "Decrypting"
                      : info.state === "locked"
                        ? "Unlock this browser to read this message"
                        : info.state === "missing"
                          ? "This browser doesn't have the key for this message"
                          : `Couldn't decrypt: ${info.reason ?? "unknown error"}`;
            lock.innerHTML = svg(info.state === "decrypted" || info.state === "pending" ? LOCK_PATH : OPEN_LOCK_PATH, label);
            withTooltip(lock, () => label);
            content.append(lock);
            if (info.state === "missing" || info.state === "locked") {
                const unlock = document.createElement("button");
                unlock.type = "button";
                unlock.className = "fe2ee-unlock";
                unlock.textContent = engine.linked ? "Get keys" : "Unlock";
                unlock.addEventListener("click", (event) => {
                    event.stopPropagation();
                    if (engine.linked && engine.hasSecret) showSettings();
                    else showUnlock();
                });
                content.append(unlock);
            }
        }
    };

    const headerLabel = (channelId: string) => {
        if (!engine.isEncrypted(channelId)) return "Turn On Encryption";
        const list = members?.channelId === channelId ? members.list : [];
        if (list.some((m) => engine.contacts[m.id]?.pendingKey)) return "Safety Number Changed";
        if (list.length && list.every((m) => engine.contacts[m.id]?.verified)) return "Encrypted and Verified";
        return "End-to-End Encrypted";
    };

    const decorateHeader = (channelId: string | null) => {
        const existing = document.querySelector<HTMLButtonElement>(".fe2ee-toggle");
        if (!channelId) return existing?.remove();
        const toolbars = [...document.querySelectorAll<HTMLElement>('[class*="toolbar__"]')];
        const toolbar = toolbars.find((t) => t.parentElement?.className.includes("upperContainer")) ?? toolbars[0];
        if (!toolbar) return;
        const on = engine.isEncrypted(channelId);
        const list = members?.channelId === channelId ? members.list : [];
        const verified = on && list.length > 0 && list.every((m) => engine.contacts[m.id]?.verified && !engine.contacts[m.id]?.pendingKey);
        let toggle = existing;
        if (!toggle || toggle.parentElement !== toolbar) {
            toggle?.remove();
            toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "fe2ee-toggle";
            toggle.addEventListener("click", () => {
                const id = currentChannel();
                if (!id) return;
                if (engine.isEncrypted(id)) showSafety(id);
                else confirmEnable(id);
            });
            withTooltip(toggle, () => headerLabel(currentChannel() ?? ""));
            toolbar.prepend(toggle);
        }
        const key = `${on}|${verified}`;
        if (toggle.dataset.key === key) return;
        toggle.dataset.key = key;
        toggle.dataset.verified = String(verified);
        toggle.setAttribute("aria-pressed", String(on));
        toggle.setAttribute("aria-label", on ? `${headerLabel(channelId)}. View safety numbers` : "Turn on end-to-end encryption");
        toggle.innerHTML = svg(verified ? VERIFIED_PATH : on ? LOCK_PATH : OPEN_LOCK_PATH);
    };

    const currentNotice = (channelId: string | null): Notice | null => {
        if (!channelId) return null;
        const temporary = transient && transient.channelId === channelId && transient.until > Date.now() ? transient : null;
        if (!engine.isEncrypted(channelId)) return temporary;
        if (failure) return { tone: "danger", text: failure };
        const changed = members?.channelId === channelId ? members.list.find((m) => engine.contacts[m.id]?.pendingKey) : undefined;
        if (changed)
            return {
                tone: "warning",
                text: `${memberName(changed)}'s safety number changed. Sending is paused until you review it.`,
                action: { label: "Review", run: () => showSafety(channelId) },
            };
        if (temporary) return temporary;
        if (engine.locked) return { tone: "info", text: "Unlock this browser to read and send encrypted messages here.", action: { label: "Unlock", run: showUnlock } };
        return null;
    };

    const decorateNotice = (channelId: string | null) => {
        const notice = currentNotice(channelId);
        const form = document.querySelector<HTMLElement>('[role="textbox"]')?.closest("form");
        if (!notice || !form) return bar.remove();
        if (bar.parentElement !== form || form.firstElementChild !== bar) form.prepend(bar);
        const key = `${notice.tone}|${notice.text}|${notice.action?.label ?? ""}`;
        if (bar.dataset.key === key) return;
        bar.dataset.key = key;
        bar.dataset.tone = notice.tone;
        bar.setAttribute("role", notice.tone === "danger" ? "alert" : "status");
        bar.innerHTML = `${svg(notice.tone === "info" ? LOCK_PATH : OPEN_LOCK_PATH)}<p>${escape(notice.text)}</p>`;
        if (notice.action) {
            const { run } = notice.action;
            bar.append(button(notice.action.label, "secondary", run));
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
            if (tooltip && !document.querySelector(".fe2ee-toggle:hover, .fe2ee-lock:hover")) hideTooltip();
            decorateMessages();
            decorateHeader(channelId);
            decorateNotice(channelId);
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
        showUnlock,
        unlockSnoozed,
        showApproval,
        dismissApproval,
        showSettings,
        mountSettings,
        beforeSend,
        renderUnlock: () => unlockOpen?.render(),
        fail: (text: string) => {
            failure = text;
            refresh();
        },
    };
};
