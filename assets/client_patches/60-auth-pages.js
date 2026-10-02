(() => {
    const remoteAuth = location.pathname.match(/^\/ra\/([A-Za-z0-9_-]{43})\/?$/)?.[1];
    const verifying = /^\/verify\/?$/.test(location.pathname);
    if (!remoteAuth && !verifying) return;

    const readToken = () => {
        try {
            return JSON.parse(localStorage.getItem("token") ?? "null");
        } catch {
            return null;
        }
    };
    let token = readToken();

    const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    const verifyToken = params.get("token");
    const instanceName = document.title || "Discord";

    if (remoteAuth && !token) {
        history.replaceState(history.state, "", `/login?redirect_to=${encodeURIComponent(location.pathname)}`);
        return;
    }
    history.replaceState(history.state, "", token ? "/channels/@me" : "/login");

    const api = (path, body) =>
        fetch(`${location.origin}/api/v9${path}`, {
            method: body ? "POST" : "GET",
            headers: { ...(token ? { authorization: token } : {}), "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
        }).then(async (res) => {
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
            return res.status === 204 ? null : res.json();
        });

    const style = document.createElement("style");
    style.textContent = `
.fc-auth-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: grid;
    place-items: center;
    background: hsl(0 0% 0% / 0.7);
    font-family: var(--font-primary, "gg sans", "Noto Sans", sans-serif);
    animation: fc-auth-fade 150ms ease-out;
}
.fc-auth-modal {
    width: min(440px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: 24px;
    border-radius: var(--radius-md, 12px);
    background: var(--modal-background, #232428);
    color: var(--text-default, #efeff0);
    border: 1px solid var(--border-subtle, hsl(240 4% 61% / 0.12));
    box-shadow: var(--shadow-high, 0 12px 24px hsl(0 0% 0% / 0.24));
    text-align: center;
    animation: fc-auth-pop 200ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.fc-auth-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    margin: 4px auto 16px;
    display: block;
    object-fit: cover;
}
.fc-auth-title {
    margin: 0 0 8px;
    font-size: 24px;
    line-height: 30px;
    font-weight: 600;
    color: var(--text-strong, #fbfbfb);
}
.fc-auth-text {
    margin: 0;
    font-size: 16px;
    line-height: 22px;
    color: var(--text-muted, #949ba4);
}
.fc-auth-text strong {
    color: var(--text-default, #efeff0);
    font-weight: 600;
}
.fc-auth-error {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--text-feedback-critical, #f57976);
}
.fc-auth-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 24px;
}
.fc-auth-button {
    height: 40px;
    border: 0;
    border-radius: var(--radius-sm, 8px);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 120ms ease;
}
.fc-auth-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.fc-auth-primary {
    background: var(--control-primary-background-default, #5865f2);
    color: #fff;
}
.fc-auth-primary:hover:not(:disabled) {
    background: var(--control-primary-background-hover, #4752c4);
}
.fc-auth-secondary {
    background: var(--control-secondary-background-default, hsl(240 4% 61% / 0.12));
    color: var(--text-default, #efeff0);
}
.fc-auth-secondary:hover:not(:disabled) {
    background: var(--control-secondary-background-hover, hsl(240 4% 61% / 0.16));
}
@keyframes fc-auth-fade {
    from {
        opacity: 0;
    }
}
@keyframes fc-auth-pop {
    from {
        opacity: 0;
        transform: scale(0.96);
    }
}
@media (prefers-reduced-motion: reduce) {
    .fc-auth-backdrop,
    .fc-auth-modal {
        animation: none;
    }
}
`;

    const element = (tag, props = {}, children = []) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    };
    const title = (textContent) => element("h1", { className: "fc-auth-title", textContent });
    const text = (children) => element("p", { className: "fc-auth-text" }, children);
    const button = (textContent, kind, onclick) => element("button", { className: `fc-auth-button fc-auth-${kind}`, textContent, onclick });
    const actions = (buttons) => element("div", { className: "fc-auth-actions" }, buttons);

    const cdn = () => `${location.protocol}//${window.GLOBAL_ENV?.CDN_HOST || location.host}`;
    const avatar = (user) =>
        element("img", {
            className: "fc-auth-avatar",
            alt: "",
            src: user.avatar
                ? `${cdn()}/avatars/${user.id}/${user.avatar}.webp?size=160`
                : `${cdn()}/embed/avatars/${user.discriminator === "0" ? Number(BigInt(user.id) >> 22n) % 6 : Number(user.discriminator) % 5}.png`,
        });

    const mount = (label) => {
        document.head.append(style);
        const backdrop = element("div", { className: "fc-auth-backdrop" });
        const modal = element("div", { className: "fc-auth-modal", role: "dialog", ariaModal: "true", ariaLabel: label });
        backdrop.append(modal);
        document.body.append(backdrop);
        return { show: (children) => modal.replaceChildren(...children), close: () => backdrop.remove() };
    };

    const approveRemoteAuth = async () => {
        const { show, close } = mount("Log in on a new device");
        show([text(["Loading…"])]);

        let user;
        let handshake;
        try {
            [user, { handshake_token: handshake }] = await Promise.all([api("/users/@me"), api("/users/@me/remote-auth", { fingerprint: remoteAuth })]);
        } catch {
            show([
                title("This QR code expired"),
                text(["Refresh the QR code on the device you're logging in to and scan it again."]),
                actions([button("Close", "primary", close)]),
            ]);
            return;
        }

        const error = element("p", { className: "fc-auth-error", hidden: true });
        const confirm = button("Log In", "primary");
        const cancel = button("Cancel", "secondary");
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
                show([avatar(user), title("You're logged in!"), text(["You can go back to your other device now."]), actions([button("Done", "primary", close)])]),
            );
        cancel.onclick = () => finish("/users/@me/remote-auth/cancel", close);

        show([
            avatar(user),
            title("Log in on a new device?"),
            text(["You're about to log in as ", element("strong", { textContent: user.global_name || user.username }), " on another device. Only continue if you scanned this QR code yourself."]),
            error,
            actions([confirm, cancel]),
        ]);
        confirm.focus();
    };

    const verifyEmail = async () => {
        const { show, close } = mount("Verify email");
        show([text(["Verifying your email…"])]);
        try {
            if (!verifyToken) throw new Error();
            const result = await api("/auth/verify", { token: verifyToken });
            const loggedIn = !!token;
            show([
                title("Email Verified!"),
                text(["Thanks for verifying your email address."]),
                actions([
                    button(`Continue to ${instanceName}`, "primary", () => {
                        if (loggedIn) return close();
                        localStorage.setItem("token", JSON.stringify(result.token));
                        location.replace("/channels/@me");
                    }),
                ]),
            ]);
        } catch {
            show([
                title("Email Verification Failed"),
                text(["This link is invalid or has expired. Request a new verification email from your account settings."]),
                actions([button("Okay", "primary", close)]),
            ]);
        }
    };

    const run = remoteAuth ? approveRemoteAuth : verifyEmail;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
})();
