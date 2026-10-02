(() => {
    const match = location.pathname.match(/^\/ra\/([A-Za-z0-9_-]{43})\/?$/);
    if (!match) return;
    const fingerprint = match[1];

    let token = null;
    try {
        token = JSON.parse(localStorage.getItem("token") ?? "null");
    } catch {}
    if (!token) {
        history.replaceState(history.state, "", `/login?redirect_to=${encodeURIComponent(location.pathname)}`);
        return;
    }
    history.replaceState(history.state, "", "/channels/@me");

    const api = (path, body) =>
        fetch(`${location.origin}/api/v9${path}`, {
            method: body ? "POST" : "GET",
            headers: { authorization: token, "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
        }).then(async (res) => {
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
            return res.status === 204 ? null : res.json();
        });

    const style = document.createElement("style");
    style.textContent = `
.fc-ra-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: grid;
    place-items: center;
    background: hsl(0 0% 0% / 0.7);
    font-family: var(--font-primary, "gg sans", "Noto Sans", sans-serif);
    animation: fc-ra-fade 150ms ease-out;
}
.fc-ra-modal {
    width: min(440px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: 24px;
    border-radius: var(--radius-md, 12px);
    background: var(--modal-background, #232428);
    color: var(--text-default, #efeff0);
    border: 1px solid var(--border-subtle, hsl(240 4% 61% / 0.12));
    box-shadow: var(--shadow-high, 0 12px 24px hsl(0 0% 0% / 0.24));
    text-align: center;
    animation: fc-ra-pop 200ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.fc-ra-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    margin: 4px auto 16px;
    display: block;
    object-fit: cover;
}
.fc-ra-title {
    margin: 0 0 8px;
    font-size: 24px;
    line-height: 30px;
    font-weight: 600;
    color: var(--text-strong, #fbfbfb);
}
.fc-ra-text {
    margin: 0;
    font-size: 16px;
    line-height: 22px;
    color: var(--text-muted, #949ba4);
}
.fc-ra-text strong {
    color: var(--text-default, #efeff0);
    font-weight: 600;
}
.fc-ra-error {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--text-feedback-critical, #f57976);
}
.fc-ra-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 24px;
}
.fc-ra-button {
    height: 40px;
    border: 0;
    border-radius: var(--radius-sm, 8px);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 120ms ease;
}
.fc-ra-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.fc-ra-primary {
    background: var(--control-primary-background-default, #5865f2);
    color: #fff;
}
.fc-ra-primary:hover:not(:disabled) {
    background: var(--control-primary-background-hover, #4752c4);
}
.fc-ra-secondary {
    background: var(--control-secondary-background-default, hsl(240 4% 61% / 0.12));
    color: var(--text-default, #efeff0);
}
.fc-ra-secondary:hover:not(:disabled) {
    background: var(--control-secondary-background-hover, hsl(240 4% 61% / 0.16));
}
@keyframes fc-ra-fade {
    from {
        opacity: 0;
    }
}
@keyframes fc-ra-pop {
    from {
        opacity: 0;
        transform: scale(0.96);
    }
}
@media (prefers-reduced-motion: reduce) {
    .fc-ra-backdrop,
    .fc-ra-modal {
        animation: none;
    }
}
`;

    const element = (tag, props = {}, children = []) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    };

    const render = async () => {
        document.head.append(style);
        const backdrop = element("div", { className: "fc-ra-backdrop" });
        const modal = element("div", { className: "fc-ra-modal", role: "dialog", ariaModal: "true", ariaLabel: "Log in on a new device" });
        backdrop.append(modal);
        document.body.append(backdrop);

        const show = (children) => modal.replaceChildren(...children);
        const close = () => backdrop.remove();

        const cdn = `${location.protocol}//${window.GLOBAL_ENV?.CDN_HOST || location.host}`;
        const avatar = (user) =>
            element("img", {
                className: "fc-ra-avatar",
                alt: "",
                src: user.avatar ? `${cdn}/avatars/${user.id}/${user.avatar}.webp?size=160` : `${cdn}/embed/avatars/${user.discriminator === "0" ? Number(BigInt(user.id) >> 22n) % 6 : Number(user.discriminator) % 5}.png`,
            });

        show([element("p", { className: "fc-ra-text", textContent: "Loading…" })]);

        let user;
        let handshake;
        try {
            [user, { handshake_token: handshake }] = await Promise.all([api("/users/@me"), api("/users/@me/remote-auth", { fingerprint })]);
        } catch (error) {
            show([
                element("h1", { className: "fc-ra-title", textContent: "This QR code expired" }),
                element("p", { className: "fc-ra-text", textContent: "Refresh the QR code on the device you're logging in to and scan it again." }),
                element("div", { className: "fc-ra-actions" }, [element("button", { className: "fc-ra-button fc-ra-primary", textContent: "Close", onclick: close })]),
            ]);
            return;
        }

        const error = element("p", { className: "fc-ra-error", hidden: true });
        const confirm = element("button", { className: "fc-ra-button fc-ra-primary", textContent: "Log In" });
        const cancel = element("button", { className: "fc-ra-button fc-ra-secondary", textContent: "Cancel" });
        const finish = async (path, done) => {
            confirm.disabled = cancel.disabled = true;
            try {
                await api(path, { handshake_token: handshake, temporary_token: false });
                done();
            } catch (e) {
                error.textContent = e.message;
                error.hidden = false;
                confirm.disabled = cancel.disabled = false;
            }
        };
        confirm.onclick = () =>
            finish("/users/@me/remote-auth/finish", () =>
                show([
                    avatar(user),
                    element("h1", { className: "fc-ra-title", textContent: "You're logged in!" }),
                    element("p", { className: "fc-ra-text", textContent: "You can go back to your other device now." }),
                    element("div", { className: "fc-ra-actions" }, [element("button", { className: "fc-ra-button fc-ra-primary", textContent: "Done", onclick: close })]),
                ]),
            );
        cancel.onclick = () => finish("/users/@me/remote-auth/cancel", close);

        const name = element("strong", { textContent: user.global_name || user.username });
        show([
            avatar(user),
            element("h1", { className: "fc-ra-title", textContent: "Log in on a new device?" }),
            element("p", { className: "fc-ra-text" }, ["You're about to log in as ", name, " on another device. Only continue if you scanned this QR code yourself."]),
            error,
            element("div", { className: "fc-ra-actions" }, [confirm, cancel]),
        ]);
        confirm.focus();
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
    else render();
})();
