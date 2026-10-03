(() => {
    const config = JSON.parse(document.getElementById("portal-config").textContent);
    const token = (() => {
        try {
            return JSON.parse(localStorage.getItem("token") ?? "null");
        } catch {
            return null;
        }
    })();
    if (!token) {
        location.replace(`/login?redirect_to=${encodeURIComponent(location.pathname)}`);
        return;
    }

    const view = document.getElementById("view");
    let pendingToken = null;
    const nav = document.getElementById("nav");
    document.getElementById("brand-name").textContent = config.instanceName;
    if (config.icon) document.getElementById("brand-icon").src = config.icon;

    const PERMISSIONS = [
        [
            "General permissions",
            [
                ["Administrator", 3],
                ["View audit log", 7],
                ["Manage server", 5],
                ["Manage roles", 28],
                ["Manage channels", 4],
                ["Kick members", 1],
                ["Ban members", 2],
                ["Moderate members", 40],
                ["Create invite", 0],
                ["Change nickname", 26],
                ["Manage nicknames", 27],
                ["Manage expressions", 30],
                ["Manage webhooks", 29],
                ["Manage events", 33],
                ["View channels", 10],
            ],
        ],
        [
            "Text permissions",
            [
                ["Send messages", 11],
                ["Send messages in threads", 38],
                ["Create public threads", 35],
                ["Create private threads", 36],
                ["Manage messages", 13],
                ["Manage threads", 34],
                ["Embed links", 14],
                ["Attach files", 15],
                ["Read message history", 16],
                ["Mention everyone", 17],
                ["Use external emojis", 18],
                ["Use external stickers", 37],
                ["Add reactions", 6],
                ["Use slash commands", 31],
                ["Create polls", 49],
                ["Send text-to-speech messages", 12],
            ],
        ],
        [
            "Voice permissions",
            [
                ["Connect", 20],
                ["Speak", 21],
                ["Video", 9],
                ["Use voice activity", 25],
                ["Priority speaker", 8],
                ["Mute members", 22],
                ["Deafen members", 23],
                ["Move members", 24],
            ],
        ],
    ];

    const SCOPES = [
        "identify",
        "email",
        "connections",
        "guilds",
        "guilds.join",
        "guilds.members.read",
        "gdm.join",
        "bot",
        "applications.commands",
        "applications.commands.permissions.update",
        "applications.entitlements",
        "role_connections.write",
        "webhook.incoming",
        "messages.read",
        "dm_channels.read",
        "relationships.read",
        "activities.read",
        "activities.write",
        "voice",
        "rpc",
        "rpc.activities.write",
        "rpc.voice.read",
        "rpc.voice.write",
        "openid",
    ];

    const FLAGS = { publicClient: 1 << 8, embedded: 1 << 17, embeddedReleased: 1 << 1 };

    const INTENTS = [
        ["presence", "Presence intent", "Required for your bot to receive presence update events.", 1 << 13],
        ["members", "Server members intent", "Required for your bot to receive events listed under GUILD_MEMBERS.", 1 << 15],
        ["content", "Message content intent", "Required for your bot to receive message content in most messages.", 1 << 19],
    ];

    const el = (tag, attrs = {}, ...children) => {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value == null || value === false) continue;
            if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
            else if (key === "class") node.className = value;
            else if (key === "value") node.value = value;
            else if (key === "checked") node.checked = value;
            else node.setAttribute(key, value === true ? "" : value);
        }
        node.append(...children.flat().filter((child) => child != null && child !== false));
        return node;
    };

    const errorText = (body, status) => {
        const walk = (node) => {
            if (!node || typeof node !== "object") return null;
            if (Array.isArray(node._errors) && node._errors[0]?.message) return node._errors[0].message;
            for (const value of Object.values(node)) {
                const found = walk(value);
                if (found) return found;
            }
            return null;
        };
        return walk(body?.errors) ?? body?.message ?? `The request failed with status ${status}.`;
    };

    const api = async (method, path, body) => {
        const res = await fetch(`/api/v9${path}`, {
            method,
            headers: { authorization: token, ...(body !== undefined && { "content-type": "application/json" }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 401) {
            location.replace(`/login?redirect_to=${encodeURIComponent(location.pathname)}`);
            throw new Error("Your session has expired.");
        }
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw Object.assign(new Error(errorText(data, res.status)), { field: Object.keys(data?.errors ?? {})[0] });
        return data;
    };

    const readFile = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

    const iconUrl = (app) => (app.icon ? `${config.cdn}/app-icons/${app.id}/${app.icon}.png?size=256` : null);
    const avatarUrl = (user) => (user?.avatar ? `${config.cdn}/avatars/${user.id}/${user.avatar}.png?size=256` : null);

    const appIcon = (app, size = "") => {
        const src = iconUrl(app);
        return src ? el("img", { class: `app-icon ${size}`, src, alt: "" }) : el("span", { class: `app-icon ${size}`, "aria-hidden": "true" }, (app.name ?? "?").trim().charAt(0).toUpperCase() || "?");
    };

    const navigate = (path, replace = false) => {
        history[replace ? "replaceState" : "pushState"](null, "", path);
        render();
    };

    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-link]");
        if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(link.getAttribute("href"));
    });
    window.addEventListener("popstate", () => render());

    const copyButton = (getValue, label = "Copy") => {
        const button = el("button", { class: "btn secondary", type: "button" }, label);
        let timer;
        button.addEventListener("click", async () => {
            await navigator.clipboard.writeText(getValue()).catch(() => null);
            button.textContent = "Copied";
            clearTimeout(timer);
            timer = setTimeout(() => (button.textContent = label), 1500);
        });
        return button;
    };

    const copyField = (label, value) => {
        const id = `field-${label.toLowerCase().replace(/\W+/g, "-")}`;
        return el("div", { class: "field" }, el("label", { for: id }, label), el("div", { class: "copy-row" }, el("input", { id, type: "text", readonly: true, value }), copyButton(() => value)));
    };

    const statusLine = () => el("p", { class: "status", role: "status" });
    const errorLine = () => el("p", { class: "error", role: "alert", hidden: true });

    const showError = (node, error) => {
        node.textContent = error instanceof Error ? error.message : String(error);
        node.hidden = false;
    };

    const flash = (node, text) => {
        node.textContent = text;
        setTimeout(() => node.textContent === text && (node.textContent = ""), 3000);
    };

    const confirmDialog = ({ title, body, action, danger = false }) =>
        new Promise((resolve) => {
            const dialog = el(
                "dialog",
                { "aria-labelledby": "confirm-title" },
                el("h2", { id: "confirm-title" }, title),
                el("p", { class: "muted" }, body),
                el(
                    "form",
                    { method: "dialog", class: "actions" },
                    el("button", { class: "btn secondary", value: "cancel" }, "Cancel"),
                    el("button", { class: `btn ${danger ? "danger" : "primary"}`, value: "confirm" }, action),
                ),
            );
            dialog.addEventListener("close", () => {
                resolve(dialog.returnValue === "confirm");
                dialog.remove();
            });
            document.body.append(dialog);
            dialog.showModal();
        });

    const switchRow = (id, label, hint, input) => el("div", { class: "switch-row" }, el("div", {}, el("label", { for: id }, label), hint && el("p", { class: "hint" }, hint)), input);

    const flagToggle = (app, id, bit, errorNode, onSaved) => {
        const toggle = el("input", {
            id,
            type: "checkbox",
            checked: (app.flags & bit) !== 0,
            onchange: async () => {
                errorNode.hidden = true;
                toggle.disabled = true;
                try {
                    Object.assign(app, await api("PATCH", `/applications/${app.id}`, { flags: toggle.checked ? app.flags | bit : app.flags & ~bit }));
                    onSaved?.();
                } catch (e) {
                    toggle.checked = !toggle.checked;
                    showError(errorNode, e);
                } finally {
                    toggle.disabled = false;
                }
            },
        });
        return toggle;
    };

    const secretBox = (id, label, value, hint) =>
        el(
            "div",
            { class: "field token-box" },
            el("label", { for: id }, label),
            el("div", { class: "copy-row" }, el("input", { id, type: "text", readonly: true, value }), copyButton(() => value)),
            el("p", { class: "hint" }, hint),
        );

    const createDialog = () => {
        const input = el("input", { id: "new-app-name", type: "text", maxlength: "32", required: true, autocomplete: "off" });
        const error = errorLine();
        const submit = el("button", { class: "btn primary", type: "submit" }, "Create");
        const dialog = el(
            "dialog",
            { "aria-labelledby": "create-title" },
            el(
                "form",
                {
                    onsubmit: async (event) => {
                        event.preventDefault();
                        error.hidden = true;
                        if (!input.value.trim()) {
                            input.setAttribute("aria-invalid", "true");
                            showError(error, "Give your application a name.");
                            input.focus();
                            return;
                        }
                        submit.disabled = true;
                        try {
                            const app = await api("POST", "/applications", { name: input.value.trim() });
                            dialog.close();
                            navigate(`/developers/applications/${app.id}/information`);
                        } catch (e) {
                            showError(error, e);
                        } finally {
                            submit.disabled = false;
                        }
                    },
                },
                el("h2", { id: "create-title" }, "Create an application"),
                el("p", { class: "muted" }, "An application holds your bot, its token and its commands."),
                el("div", { class: "field", style: "margin-top:16px" }, el("label", { for: "new-app-name" }, "Name"), input, error),
                el("div", { class: "actions" }, el("button", { class: "btn secondary", type: "button", onclick: () => dialog.close() }, "Cancel"), submit),
            ),
        );
        input.setAttribute("aria-describedby", "create-error");
        error.id = "create-error";
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
        input.focus();
    };

    const setNav = (app, section) => {
        const link = (href, label, current) => el("a", { href, "data-link": true, "aria-current": current ? "page" : null }, label);
        nav.replaceChildren(
            ...[
                link("/developers/applications", "Applications", !app),
                app && el("p", { class: "nav-heading", title: app.name }, app.name),
                app && link(`/developers/applications/${app.id}/information`, "General information", section === "information"),
                app && link(`/developers/applications/${app.id}/installation`, "Installation", section === "installation"),
                app && link(`/developers/applications/${app.id}/oauth2`, "OAuth2", section === "oauth2"),
                app && link(`/developers/applications/${app.id}/bot`, "Bot", section === "bot"),
                app && link(`/developers/applications/${app.id}/emojis`, "Emojis", section === "emojis"),
                app && link(`/developers/applications/${app.id}/rich-presence`, "Rich Presence", section === "rich-presence"),
                app && link(`/developers/applications/${app.id}/testers`, "App Testers", section === "testers"),
                app && link(`/developers/applications/${app.id}/activities`, "Activities", section === "activities"),
            ].filter(Boolean),
        );
    };

    const renderList = async () => {
        setNav(null);
        document.title = `Applications | ${config.instanceName} Developer Portal`;
        view.replaceChildren(el("p", { class: "loading" }, "Loading applications"));
        const apps = await api("GET", "/applications");
        const head = el(
            "div",
            { class: "page-head" },
            el("h1", {}, "Applications"),
            el("button", { class: "btn primary", type: "button", onclick: createDialog }, "New application"),
        );
        const lead = el("p", { class: "muted page-lead" }, "Create an application to get a bot, a token and an invite link for your servers.");
        const body = apps.length
            ? el(
                  "div",
                  { class: "app-grid" },
                  apps
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((app) => el("a", { class: "app-card", href: `/developers/applications/${app.id}/information`, "data-link": true }, appIcon(app), el("span", {}, app.name))),
              )
            : el(
                  "div",
                  { class: "empty" },
                  el("h2", {}, "No applications yet"),
                  el("p", { class: "muted" }, "Your applications appear here. Create one to set up a bot."),
                  el("button", { class: "btn primary", type: "button", onclick: createDialog }, "Create an application"),
              );
        view.replaceChildren(head, lead, body);
    };

    const renderInformation = (app) => {
        const name = el("input", { id: "app-name", type: "text", maxlength: "32", value: app.name });
        const description = el("textarea", { id: "app-description", maxlength: "400" }, app.description ?? "");
        const endpoint = el("input", { id: "app-endpoint", type: "url", inputmode: "url", placeholder: "https://example.com/interactions", value: app.interactions_endpoint_url ?? "" });
        const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
        let icon;
        const preview = el("span", {}, appIcon(app));
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            icon = await readFile(file);
            preview.replaceChildren(el("img", { class: "app-icon", src: icon, alt: "" }));
        });
        const terms = el("input", { id: "app-terms", type: "url", inputmode: "url", placeholder: "https://example.com/terms", value: app.terms_of_service_url ?? "" });
        const privacy = el("input", { id: "app-privacy", type: "url", inputmode: "url", placeholder: "https://example.com/privacy", value: app.privacy_policy_url ?? "" });
        const tags = [...(app.tags ?? [])];
        const tagInput = el("input", { id: "app-tags", type: "text", maxlength: "20", placeholder: "Add a tag and press Enter", autocomplete: "off" });
        const tagList = el("ul", { class: "tag-list", "aria-label": "Tags" });
        const renderTags = () => {
            tagList.replaceChildren(
                ...tags.map((tag) =>
                    el(
                        "li",
                        { class: "tag" },
                        el("span", {}, tag),
                        el(
                            "button",
                            {
                                type: "button",
                                class: "tag-remove",
                                "aria-label": `Remove ${tag}`,
                                onclick: () => {
                                    tags.splice(tags.indexOf(tag), 1);
                                    renderTags();
                                    tagInput.focus();
                                },
                            },
                            "×",
                        ),
                    ),
                ),
            );
            tagInput.disabled = tags.length >= 5;
            tagInput.placeholder = tags.length >= 5 ? "You can add up to 5 tags" : "Add a tag and press Enter";
        };
        tagInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            const value = tagInput.value.trim();
            if (value && !tags.includes(value) && tags.length < 5) tags.push(value);
            tagInput.value = "";
            renderTags();
        });
        renderTags();
        const status = statusLine();
        const error = errorLine();
        const save = el("button", { class: "btn primary", type: "submit" }, "Save changes");
        const form = el(
            "form",
            {
                class: "card",
                onsubmit: async (event) => {
                    event.preventDefault();
                    error.hidden = true;
                    name.removeAttribute("aria-invalid");
                    endpoint.removeAttribute("aria-invalid");
                    terms.removeAttribute("aria-invalid");
                    privacy.removeAttribute("aria-invalid");
                    if (!name.value.trim()) {
                        name.setAttribute("aria-invalid", "true");
                        showError(error, "Give your application a name.");
                        name.focus();
                        return;
                    }
                    save.disabled = true;
                    try {
                        const updated = await api("PATCH", `/applications/${app.id}`, {
                            name: name.value.trim(),
                            description: description.value,
                            interactions_endpoint_url: endpoint.value.trim() || null,
                            terms_of_service_url: terms.value.trim() || null,
                            privacy_policy_url: privacy.value.trim() || null,
                            tags: [...tags, ...(tagInput.value.trim() && tags.length < 5 ? [tagInput.value.trim()] : [])],
                            ...(icon && { icon }),
                        });
                        tags.splice(0, tags.length, ...(updated.tags ?? []));
                        tagInput.value = "";
                        renderTags();
                        Object.assign(app, updated);
                        icon = undefined;
                        setNav(app, "information");
                        flash(status, "Changes saved.");
                    } catch (e) {
                        const field = /endpoint/i.test(e.message) ? endpoint : /terms/i.test(e.field ?? "") ? terms : /privacy/i.test(e.field ?? "") ? privacy : null;
                        if (field) {
                            field.setAttribute("aria-invalid", "true");
                            field.focus();
                        }
                        showError(error, e);
                    } finally {
                        save.disabled = false;
                    }
                },
            },
            el("h2", {}, "General information"),
            el("p", { class: "muted" }, "What people see when they add your application or meet its bot."),
            el(
                "div",
                { class: "fields" },
                el(
                    "div",
                    { class: "media-row" },
                    preview,
                    el("div", { class: "field" }, el("span", { class: "label" }, "App icon"), el("button", { class: "btn secondary", type: "button", onclick: () => fileInput.click() }, "Upload image"), fileInput),
                ),
                el("div", { class: "field" }, el("label", { for: "app-name" }, "Name"), name),
                el("div", { class: "field" }, el("label", { for: "app-description" }, "Description"), description, el("p", { class: "hint" }, "Shown on the app's profile, up to 400 characters.")),
                el(
                    "div",
                    { class: "field" },
                    el("label", { for: "app-endpoint" }, "Interactions endpoint URL"),
                    endpoint,
                    el("p", { class: "hint" }, "Optional. Interactions are sent to this URL as HTTP POST requests instead of over the gateway. The URL has to answer a ping before it is saved."),
                ),
                el(
                    "div",
                    { class: "field" },
                    el("label", { for: "app-tags" }, "Tags"),
                    tagList,
                    tagInput,
                    el("p", { class: "hint" }, "Up to 5 tags, 20 characters each. They help people find your app."),
                ),
                el("div", { class: "field-row" }, el("div", { class: "field" }, el("label", { for: "app-terms" }, "Terms of Service URL"), terms), el("div", { class: "field" }, el("label", { for: "app-privacy" }, "Privacy Policy URL"), privacy)),
                el("div", { class: "field-row" }, copyField("Application ID", app.id), copyField("Public key", app.verify_key ?? "")),
            ),
            el("div", { class: "actions" }, save, status),
            error,
        );
        const remove = el(
            "button",
            {
                class: "btn danger",
                type: "button",
                onclick: async () => {
                    const ok = await confirmDialog({
                        title: `Delete ${app.name}?`,
                        body: "This deletes the application, its bot and its commands, and removes the bot from every server. You can't undo this.",
                        action: "Delete application",
                        danger: true,
                    });
                    if (!ok) return;
                    try {
                        await api("POST", `/applications/${app.id}/delete`, {});
                        navigate("/developers/applications");
                    } catch (e) {
                        showError(deleteError, e);
                    }
                },
            },
            "Delete application",
        );
        const deleteError = errorLine();
        const danger = el("section", { class: "card" }, el("h2", {}, "Delete application"), el("p", { class: "muted" }, "Deleting an application also deletes its bot user."), remove, deleteError);
        return [form, danger];
    };

    const renderBot = (app) => {
        const tokenError = errorLine();
        const tokenBox = el("div", { class: "token-box", hidden: true });
        const showToken = (value) => {
            tokenBox.replaceChildren(
                el(
                    "div",
                    { class: "field" },
                    el("label", { for: "bot-token" }, "Token"),
                    el("div", { class: "copy-row" }, el("input", { id: "bot-token", type: "text", readonly: true, value }), copyButton(() => value)),
                    el("p", { class: "hint" }, "Copy it now. For your security the token is shown only once, and resetting it again signs out every running copy of the bot."),
                ),
            );
            tokenBox.hidden = false;
        };

        if (!app.bot) {
            const add = el(
                "button",
                {
                    class: "btn primary",
                    type: "button",
                    onclick: async () => {
                        add.disabled = true;
                        try {
                            pendingToken = (await api("POST", `/applications/${app.id}/bot`))?.token ?? null;
                            await render();
                        } catch (e) {
                            showError(tokenError, e);
                            add.disabled = false;
                        }
                    },
                },
                "Add bot",
            );
            return [el("section", { class: "card" }, el("h2", {}, "Bot"), el("p", { class: "muted" }, "Give this application a bot user so it can join servers, read events and answer commands."), add, tokenError)];
        }

        const username = el("input", { id: "bot-username", type: "text", maxlength: "32", value: app.bot.username });
        const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
        const avatarSrc = avatarUrl(app.bot);
        const preview = el("span", {}, avatarSrc ? el("img", { class: "app-icon small round", src: avatarSrc, alt: "" }) : appIcon({ name: app.bot.username }, "small round"));
        let avatar;
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            avatar = await readFile(file);
            preview.replaceChildren(el("img", { class: "app-icon small round", src: avatar, alt: "" }));
        });
        const status = statusLine();
        const error = errorLine();
        const save = el("button", { class: "btn primary", type: "submit" }, "Save changes");
        const profile = el(
            "form",
            {
                class: "card",
                onsubmit: async (event) => {
                    event.preventDefault();
                    error.hidden = true;
                    username.removeAttribute("aria-invalid");
                    if (!username.value.trim()) {
                        username.setAttribute("aria-invalid", "true");
                        showError(error, "Give your bot a username.");
                        username.focus();
                        return;
                    }
                    save.disabled = true;
                    try {
                        app.bot = await api("PATCH", `/applications/${app.id}/bot`, { username: username.value.trim(), ...(avatar && { avatar }) });
                        avatar = undefined;
                        flash(status, "Changes saved.");
                    } catch (e) {
                        username.setAttribute("aria-invalid", "true");
                        showError(error, e);
                    } finally {
                        save.disabled = false;
                    }
                },
            },
            el("h2", {}, "Bot"),
            el("p", { class: "muted" }, "Your bot's profile in servers and direct messages."),
            el(
                "div",
                { class: "fields" },
                el(
                    "div",
                    { class: "media-row" },
                    preview,
                    el("div", { class: "field" }, el("span", { class: "label" }, "Avatar"), el("button", { class: "btn secondary", type: "button", onclick: () => fileInput.click() }, "Upload image"), fileInput),
                ),
                el("div", { class: "field" }, el("label", { for: "bot-username" }, "Username"), username),
            ),
            el("div", { class: "actions" }, save, status),
            error,
        );

        const reset = el(
            "button",
            {
                class: "btn primary",
                type: "button",
                onclick: async () => {
                    const ok = await confirmDialog({
                        title: "Reset the bot's token?",
                        body: "Your bot stops working until you give it the new token.",
                        action: "Reset token",
                    });
                    if (!ok) return;
                    tokenError.hidden = true;
                    try {
                        showToken((await api("POST", `/applications/${app.id}/bot/reset`, {})).token);
                    } catch (e) {
                        showError(tokenError, e);
                    }
                },
            },
            "Reset token",
        );
        const tokenCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Token"),
            el("p", { class: "muted" }, "Your bot signs in with its token. Keep it secret, anyone who has it controls your bot."),
            reset,
            tokenBox,
            tokenError,
        );

        const publicError = errorLine();
        const publicToggle = el("input", {
            id: "bot-public",
            type: "checkbox",
            checked: app.bot_public !== false,
            onchange: async () => {
                publicError.hidden = true;
                try {
                    Object.assign(app, await api("PATCH", `/applications/${app.id}`, { bot_public: publicToggle.checked }));
                } catch (e) {
                    publicToggle.checked = !publicToggle.checked;
                    showError(publicError, e);
                }
            },
        });
        const codeGrantToggle = el("input", {
            id: "bot-code-grant",
            type: "checkbox",
            checked: app.bot_require_code_grant === true,
            onchange: async () => {
                publicError.hidden = true;
                try {
                    Object.assign(app, await api("PATCH", `/applications/${app.id}`, { bot_require_code_grant: codeGrantToggle.checked }));
                } catch (e) {
                    codeGrantToggle.checked = !codeGrantToggle.checked;
                    showError(publicError, e);
                }
            },
        });
        const publicCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Authorization flow"),
            el("p", { class: "muted" }, "Who can add the bot, and how."),
            el(
                "div",
                { class: "fields" },
                switchRow("bot-public", "Let anyone add this bot", "When this is off, only you can add the bot to servers.", publicToggle),
                switchRow(
                    "bot-code-grant",
                    "Require the OAuth2 code grant",
                    "People can add the bot only through a link that sends them back to one of your redirect URLs with an authorization code.",
                    codeGrantToggle,
                ),
            ),
            publicError,
        );
        const intentsError = errorLine();
        const intentsCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Privileged gateway intents"),
            el("p", { class: "muted" }, "Some gateway intents are privileged. Turn on the ones your bot asks for when it connects."),
            el(
                "div",
                { class: "fields" },
                INTENTS.map(([key, label, description, bit]) => {
                    const toggle = el("input", {
                        id: `intent-${key}`,
                        type: "checkbox",
                        checked: (app.flags & (bit | (bit >> 1))) !== 0,
                        onchange: async () => {
                            intentsError.hidden = true;
                            const flags = toggle.checked ? app.flags | bit : app.flags & ~(bit | (bit >> 1));
                            try {
                                Object.assign(app, await api("PATCH", `/applications/${app.id}`, { flags }));
                            } catch (e) {
                                toggle.checked = !toggle.checked;
                                showError(intentsError, e);
                            }
                        },
                    });
                    return el("div", { class: "switch-row" }, el("div", {}, el("label", { for: `intent-${key}` }, label), el("p", { class: "hint" }, description)), toggle);
                }),
            ),
            intentsError,
        );
        if (pendingToken) showToken(pendingToken);
        pendingToken = null;
        return [profile, tokenCard, publicCard, intentsCard];
    };

    const permissionPicker = (initial = 0n) => {
        const boxes = [];
        const groups = PERMISSIONS.map(([title, items]) =>
            el(
                "div",
                { class: "check-group" },
                el("h3", {}, title),
                el(
                    "div",
                    { class: "check-grid" },
                    items.map(([label, bit]) => {
                        const box = el("input", { type: "checkbox", "data-bit": bit, checked: (initial & (1n << BigInt(bit))) !== 0n });
                        boxes.push(box);
                        return el("label", { class: "check" }, box, label);
                    }),
                ),
            ),
        );
        return { groups, boxes, value: () => boxes.filter((box) => box.checked).reduce((sum, box) => sum | (1n << BigInt(box.dataset.bit)), 0n) };
    };

    const renderInstallation = (app) => {
        const config = app.integration_types_config ?? {};
        const status = statusLine();
        const error = errorLine();
        const contexts = {
            1: el("input", { id: "context-user", type: "checkbox", checked: "1" in config }),
            0: el("input", { id: "context-guild", type: "checkbox", checked: "0" in config }),
        };
        const contextsCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Installation contexts"),
            el("p", { class: "muted" }, "Choose where people can install your app."),
            el(
                "div",
                { class: "fields" },
                el(
                    "div",
                    { class: "switch-row" },
                    el("div", {}, el("label", { for: "context-user" }, "User install"), el("p", { class: "hint" }, "People install the app on their account and use its commands anywhere.")),
                    contexts[1],
                ),
                el(
                    "div",
                    { class: "switch-row" },
                    el("div", {}, el("label", { for: "context-guild" }, "Guild install"), el("p", { class: "hint" }, "People who can manage a server add the app to it.")),
                    contexts[0],
                ),
            ),
        );

        const initialType = app.custom_install_url ? "custom" : Object.values(config).some((entry) => entry?.oauth2_install_params) ? "discord" : "none";
        const radios = Object.fromEntries(
            ["discord", "custom", "none"].map((type) => [type, el("input", { type: "radio", name: "install-link", id: `install-link-${type}`, value: type, checked: type === initialType })]),
        );
        const providedLink = `${location.origin}/oauth2/authorize?client_id=${app.id}`;
        const customUrl = el("input", { id: "install-url", type: "url", inputmode: "url", placeholder: "https://example.com/install", value: app.custom_install_url ?? "" });
        const providedField = el(
            "div",
            { class: "field" },
            el("label", { for: "install-provided" }, "Install link"),
            el("div", { class: "copy-row" }, el("input", { id: "install-provided", type: "text", readonly: true, value: providedLink }), copyButton(() => providedLink)),
        );
        const customField = el("div", { class: "field" }, el("label", { for: "install-url" }, "Custom URL"), customUrl);
        const linkCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Install link"),
            el("p", { class: "muted" }, "The link behind the Add App button on your app's profile."),
            el(
                "div",
                { class: "fields" },
                el(
                    "div",
                    { class: "radio-list", role: "radiogroup", "aria-label": "Install link" },
                    el("label", { class: "check" }, radios.discord, "Provided link"),
                    el("label", { class: "check" }, radios.custom, "Custom URL"),
                    el("label", { class: "check" }, radios.none, "None"),
                ),
                providedField,
                customField,
            ),
        );

        const guildParams = config["0"]?.oauth2_install_params ?? { scopes: ["applications.commands", "bot"], permissions: "0" };
        const guildScopes = {
            "applications.commands": el("input", { type: "checkbox", checked: guildParams.scopes.includes("applications.commands") }),
            bot: el("input", { type: "checkbox", checked: guildParams.scopes.includes("bot") }),
        };
        const picker = permissionPicker(BigInt(guildParams.permissions || "0"));
        const permissionsGroup = el("div", { class: "check-group" }, el("h3", {}, "Guild install permissions"), picker.groups);
        const userSettings = el("div", { class: "check-group" }, el("h3", {}, "User install scopes"), el("label", { class: "check" }, el("input", { type: "checkbox", checked: true, disabled: true }), "applications.commands"));
        const guildSettings = el(
            "div",
            { class: "check-group" },
            el("h3", {}, "Guild install scopes"),
            el(
                "div",
                { class: "check-grid" },
                Object.entries(guildScopes).map(([scope, box]) => el("label", { class: "check" }, box, scope)),
            ),
        );
        const settingsCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Default install settings"),
            el("p", { class: "muted" }, "The scopes and permissions the provided link asks for."),
            userSettings,
            guildSettings,
            permissionsGroup,
        );

        const linkType = () => Object.values(radios).find((radio) => radio.checked)?.value;
        const update = () => {
            providedField.hidden = linkType() !== "discord";
            customField.hidden = linkType() !== "custom";
            settingsCard.hidden = linkType() !== "discord";
            userSettings.hidden = !contexts[1].checked;
            guildSettings.hidden = !contexts[0].checked;
            permissionsGroup.hidden = !contexts[0].checked || !guildScopes.bot.checked;
        };
        [...Object.values(contexts), ...Object.values(radios), ...Object.values(guildScopes)].forEach((input) => input.addEventListener("change", update));
        update();

        const save = el("button", { class: "btn primary", type: "submit" }, "Save changes");
        const form = el(
            "form",
            {
                onsubmit: async (event) => {
                    event.preventDefault();
                    error.hidden = true;
                    customUrl.removeAttribute("aria-invalid");
                    const type = linkType();
                    if (!contexts[0].checked && !contexts[1].checked) return showError(error, "Pick at least one installation context.");
                    if (type === "custom" && !customUrl.value.trim()) {
                        customUrl.setAttribute("aria-invalid", "true");
                        showError(error, "Enter the URL people should open to install your app.");
                        customUrl.focus();
                        return;
                    }
                    const scopes = Object.entries(guildScopes)
                        .filter(([, box]) => box.checked)
                        .map(([scope]) => scope);
                    if (type === "discord" && contexts[0].checked && !scopes.length) return showError(error, "Pick at least one scope for guild installs.");
                    const integration_types_config = {
                        ...(contexts[0].checked && { 0: type === "discord" ? { oauth2_install_params: { scopes, permissions: scopes.includes("bot") ? picker.value().toString() : "0" } } : {} }),
                        ...(contexts[1].checked && { 1: type === "discord" ? { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } } : {} }),
                    };
                    save.disabled = true;
                    try {
                        Object.assign(app, await api("PATCH", `/applications/${app.id}`, { integration_types_config, custom_install_url: type === "custom" ? customUrl.value.trim() : null }));
                        flash(status, "Changes saved.");
                    } catch (e) {
                        if (/url/i.test(e.message)) customUrl.setAttribute("aria-invalid", "true");
                        showError(error, e);
                    } finally {
                        save.disabled = false;
                    }
                },
            },
            contextsCard,
            linkCard,
            settingsCard,
            el("div", { class: "actions" }, save, status),
            error,
        );
        return [form];
    };

    const renderEmojis = async (app) => {
        const { items } = await api("GET", `/applications/${app.id}/emojis`);
        const error = errorLine();
        const status = statusLine();
        const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
        const emojiUrl = (emoji) => `${config.cdn}/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=96`;
        const list = el("div", { class: "emoji-grid" });
        const renderItems = () =>
            list.replaceChildren(
                ...(items.length
                    ? items.map((emoji) =>
                          el(
                              "div",
                              { class: "emoji-item" },
                              el("img", { src: emojiUrl(emoji), alt: `:${emoji.name}:` }),
                              el("span", { title: emoji.name }, emoji.name),
                              el(
                                  "button",
                                  {
                                      class: "btn secondary",
                                      type: "button",
                                      "aria-label": `Delete ${emoji.name}`,
                                      onclick: async () => {
                                          const ok = await confirmDialog({
                                              title: `Delete :${emoji.name}:?`,
                                              body: "Messages that use this emoji show its name instead.",
                                              action: "Delete emoji",
                                              danger: true,
                                          });
                                          if (!ok) return;
                                          try {
                                              await api("DELETE", `/applications/${app.id}/emojis/${emoji.id}`);
                                              items.splice(items.indexOf(emoji), 1);
                                              renderItems();
                                          } catch (e) {
                                              showError(error, e);
                                          }
                                      },
                                  },
                                  "Delete",
                              ),
                          ),
                      )
                    : [el("p", { class: "muted" }, "Your app has no emojis yet. Upload one and your bot can use it in any server or DM.")]),
            );
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            fileInput.value = "";
            if (!file) return;
            error.hidden = true;
            const name = file.name
                .replace(/\.[^.]+$/, "")
                .replace(/\W/g, "_")
                .slice(0, 32)
                .padEnd(2, "_");
            try {
                items.push(await api("POST", `/applications/${app.id}/emojis`, { name, image: await readFile(file) }));
                renderItems();
                flash(status, `Uploaded :${name}:.`);
            } catch (e) {
                showError(error, e);
            }
        });
        renderItems();
        return [
            el(
                "section",
                { class: "card" },
                el("h2", {}, "Emojis"),
                el("p", { class: "muted" }, "Emojis your app owns. Its bot can use them anywhere, without being in the server they came from."),
                el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: () => fileInput.click() }, "Upload emoji"), fileInput, status),
                error,
                list,
            ),
        ];
    };

    const renderOAuth = (app) => {
        const secretError = errorLine();
        const secretSlot = el("div");
        const resetSecret = el(
            "button",
            {
                class: "btn secondary",
                type: "button",
                onclick: async () => {
                    const ok = await confirmDialog({
                        title: "Reset the client secret?",
                        body: "Anything that uses the current secret stops working until you give it the new one.",
                        action: "Reset secret",
                    });
                    if (!ok) return;
                    secretError.hidden = true;
                    try {
                        const { secret } = await api("POST", `/applications/${app.id}/reset`, {});
                        secretSlot.replaceChildren(secretBox("client-secret", "New client secret", secret, "Copy it now. For your security the secret is shown only once."));
                    } catch (e) {
                        showError(secretError, e);
                    }
                },
            },
            "Reset secret",
        );
        const publicError = errorLine();
        const clientCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Client information"),
            el("p", { class: "muted" }, "Your app signs people in with these credentials. Keep the secret on your server."),
            el(
                "div",
                { class: "fields" },
                el("div", { class: "field-row" }, copyField("Client ID", app.id), el("div", { class: "field" }, el("span", { class: "label" }, "Client secret"), el("div", {}, resetSecret))),
                secretSlot,
                switchRow(
                    "oauth-public-client",
                    "Public client",
                    "For apps that can't keep a secret, like mobile and desktop apps. They exchange codes with PKCE instead of the client secret.",
                    flagToggle(app, "oauth-public-client", FLAGS.publicClient, publicError),
                ),
            ),
            secretError,
            publicError,
        );

        const redirects = [...(app.redirect_uris ?? [])];
        const redirectList = el("div", { class: "fields" });
        const redirectStatus = statusLine();
        const redirectError = errorLine();
        const redirectSelect = el("select", { id: "oauth-redirect" });
        const renderRedirectSelect = () => {
            const current = redirectSelect.value;
            redirectSelect.replaceChildren(el("option", { value: "" }, "No redirect"), ...(app.redirect_uris ?? []).map((uri) => el("option", { value: uri }, uri)));
            redirectSelect.value = (app.redirect_uris ?? []).includes(current) ? current : "";
        };
        const renderRedirects = () => {
            redirectList.replaceChildren(
                ...redirects.map((uri, index) => {
                    const input = el("input", {
                        id: `redirect-${index}`,
                        type: "url",
                        inputmode: "url",
                        placeholder: "https://example.com/callback",
                        value: uri,
                        "aria-label": `Redirect ${index + 1}`,
                        oninput: () => (redirects[index] = input.value),
                    });
                    return el(
                        "div",
                        { class: "copy-row" },
                        input,
                        el(
                            "button",
                            {
                                class: "btn secondary",
                                type: "button",
                                "aria-label": `Remove redirect ${index + 1}`,
                                onclick: () => {
                                    redirects.splice(index, 1);
                                    renderRedirects();
                                },
                            },
                            "Remove",
                        ),
                    );
                }),
                ...(redirects.length ? [] : [el("p", { class: "muted" }, "No redirects yet. Add one to use the authorization code or implicit grant.")]),
            );
        };
        renderRedirects();
        const saveRedirects = el("button", { class: "btn primary", type: "submit" }, "Save changes");
        const redirectsCard = el(
            "form",
            {
                class: "card",
                onsubmit: async (event) => {
                    event.preventDefault();
                    redirectError.hidden = true;
                    redirectList.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
                    const cleaned = redirects.map((uri) => uri.trim());
                    const blank = cleaned.findIndex((uri) => !uri);
                    if (blank !== -1) {
                        const input = redirectList.querySelectorAll("input")[blank];
                        input.setAttribute("aria-invalid", "true");
                        input.focus();
                        return showError(redirectError, "Enter a URL or remove the empty redirect.");
                    }
                    saveRedirects.disabled = true;
                    try {
                        Object.assign(app, await api("PATCH", `/applications/${app.id}`, { redirect_uris: cleaned }));
                        redirects.splice(0, redirects.length, ...app.redirect_uris);
                        renderRedirects();
                        renderRedirectSelect();
                        update();
                        flash(redirectStatus, "Changes saved.");
                    } catch (e) {
                        const index = Number(/redirect_uris\.(\d+)/.exec(e.field ?? "")?.[1]);
                        const input = Number.isNaN(index) ? null : redirectList.querySelectorAll("input")[index];
                        input?.setAttribute("aria-invalid", "true");
                        input?.focus();
                        showError(redirectError, e);
                    } finally {
                        saveRedirects.disabled = false;
                    }
                },
            },
            el("h2", {}, "Redirects"),
            el("p", { class: "muted" }, "After someone authorizes your app, they are sent back to one of these URLs. You can add up to 10."),
            redirectList,
            el(
                "div",
                { class: "actions" },
                el(
                    "button",
                    {
                        class: "btn secondary",
                        type: "button",
                        onclick: () => {
                            if (redirects.length >= 10) return showError(redirectError, "You can add up to 10 redirects.");
                            redirects.push("");
                            renderRedirects();
                            redirectList.querySelectorAll("input")[redirects.length - 1]?.focus();
                        },
                    },
                    "Add redirect",
                ),
                saveRedirects,
                redirectStatus,
            ),
            redirectError,
        );

        const scopes = Object.fromEntries(SCOPES.map((scope) => [scope, el("input", { type: "checkbox", checked: scope === "bot" || scope === "applications.commands" })]));
        const { groups, boxes: permissionBoxes, value: permissionValue } = permissionPicker();
        const permissionsCard = el("section", { class: "card" }, el("h2", {}, "Bot permissions"), el("p", { class: "muted" }, "The bot gets a role with these permissions in each server it joins."), groups);
        const contexts = app.integration_types_config ?? { 0: {} };
        const installTypes = Object.fromEntries(
            ["0", "1"].map((type) => [type, el("input", { type: "radio", name: "oauth-integration", id: `oauth-integration-${type}`, value: type, checked: type === ("0" in contexts ? "0" : "1"), disabled: !(type in contexts) })]),
        );
        const installRow = el(
            "div",
            { class: "field" },
            el("span", { class: "label" }, "Integration type"),
            el(
                "div",
                { class: "radio-list", role: "radiogroup", "aria-label": "Integration type" },
                el("label", { class: "check" }, installTypes[0], "Guild install"),
                el("label", { class: "check" }, installTypes[1], "User install"),
            ),
        );
        const redirectHint = el("p", { class: "hint" });
        const redirectRow = el("div", { class: "field" }, el("label", { for: "oauth-redirect" }, "Redirect"), redirectSelect, redirectHint);
        renderRedirectSelect();
        const output = el("input", { id: "oauth-url", type: "text", readonly: true });
        const open = el("a", { class: "btn primary", target: "_blank", rel: "noopener" }, "Open link");
        const permissionsValue = el("input", { id: "oauth-permissions", type: "text", readonly: true });
        const permissionsField = el("div", { class: "field" }, el("label", { for: "oauth-permissions" }, "Permissions integer"), el("div", { class: "copy-row" }, permissionsValue, copyButton(() => permissionsValue.value)));
        const update = () => {
            const chosen = Object.entries(scopes)
                .filter(([, box]) => box.checked)
                .map(([scope]) => scope);
            const needsRedirect = chosen.some((scope) => scope !== "bot" && scope !== "applications.commands") || (scopes.bot.checked && app.bot_require_code_grant);
            const bits = permissionValue();
            permissionsCard.hidden = !scopes.bot.checked;
            permissionsField.hidden = !scopes.bot.checked;
            installRow.hidden = scopes.bot.checked || !scopes["applications.commands"].checked || chosen.length !== 1;
            redirectHint.textContent = !app.redirect_uris?.length
                ? "Add a redirect above to use scopes that need one."
                : needsRedirect
                  ? "These scopes send people back to your app with a code, so pick where to send them."
                  : "Optional. Pick one to send people back to your app after they authorize it.";
            const params = new URLSearchParams({ client_id: app.id });
            if (scopes.bot.checked) params.set("permissions", bits.toString());
            if (!installRow.hidden) params.set("integration_type", installTypes[1].checked ? "1" : "0");
            else if (scopes.bot.checked) params.set("integration_type", "0");
            if (redirectSelect.value) {
                params.set("response_type", "code");
                params.set("redirect_uri", redirectSelect.value);
            }
            params.set("scope", chosen.join(" "));
            const missingRedirect = needsRedirect && !redirectSelect.value;
            if (missingRedirect && chosen.length) redirectSelect.setAttribute("aria-invalid", "true");
            else redirectSelect.removeAttribute("aria-invalid");
            const url = `${location.origin}/oauth2/authorize?${params}`;
            const ready = chosen.length > 0 && !missingRedirect;
            output.value = ready ? url : "";
            output.placeholder = !chosen.length ? "Pick at least one scope." : "Pick a redirect to finish the link.";
            permissionsValue.value = bits.toString();
            open.href = url;
            open.hidden = !ready;
        };
        [...Object.values(scopes), ...permissionBoxes, ...Object.values(installTypes), redirectSelect].forEach((box) => box.addEventListener("change", update));
        const scopesCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "OAuth2 URL generator"),
            el("p", { class: "muted" }, "Pick the scopes your app needs. Use the link to add your bot to a server or to sign people in."),
            el(
                "div",
                { class: "check-grid" },
                Object.entries(scopes).map(([scope, box]) => el("label", { class: "check" }, box, scope)),
            ),
        );
        const outputCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Generated URL"),
            el(
                "div",
                { class: "fields" },
                installRow,
                redirectRow,
                el("div", { class: "field" }, el("label", { for: "oauth-url" }, "Generated URL"), el("div", { class: "copy-row" }, output, copyButton(() => output.value))),
                permissionsField,
            ),
            el("div", { class: "actions" }, open),
        );
        update();
        return [clientCard, redirectsCard, scopesCard, permissionsCard, outputCard];
    };

    const renderRichPresence = async (app) => {
        const assets = await api("GET", `/oauth2/applications/${app.id}/assets`);
        const coverError = errorLine();
        const coverStatus = statusLine();
        const coverInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
        const coverPreview = el("div", { class: "cover-preview" });
        const renderCover = () =>
            coverPreview.replaceChildren(
                app.cover_image ? el("img", { src: `${config.cdn}/app-icons/${app.id}/${app.cover_image}.png?size=1024`, alt: "Current Rich Presence invite image" }) : el("span", { class: "muted" }, "No image yet"),
            );
        renderCover();
        coverInput.addEventListener("change", async () => {
            const file = coverInput.files?.[0];
            coverInput.value = "";
            if (!file) return;
            coverError.hidden = true;
            try {
                Object.assign(app, await api("PATCH", `/applications/${app.id}`, { cover_image: await readFile(file) }));
                renderCover();
                flash(coverStatus, "Image saved.");
            } catch (e) {
                showError(coverError, e);
            }
        });
        const coverCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Rich Presence invite image"),
            el("p", { class: "muted" }, "Shown when someone invites a friend to join what they're doing in your app. Use at least 1024 by 576 pixels."),
            coverPreview,
            el("div", { class: "actions" }, el("button", { class: "btn secondary", type: "button", onclick: () => coverInput.click() }, "Upload image"), coverInput, coverStatus),
            coverError,
        );

        const error = errorLine();
        const status = statusLine();
        const nameInput = el("input", { id: "asset-name", type: "text", maxlength: "32", autocomplete: "off", placeholder: "large_logo" });
        const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
        let pending;
        const fileLabel = el("span", { class: "hint file-name" }, "No image chosen");
        fileInput.addEventListener("change", () => {
            pending = fileInput.files?.[0];
            fileLabel.textContent = pending ? pending.name : "No image chosen";
            if (pending && !nameInput.value.trim())
                nameInput.value = pending.name
                    .replace(/\.[^.]+$/, "")
                    .toLowerCase()
                    .replace(/[^a-z0-9_]+/g, "_")
                    .slice(0, 32);
        });
        const grid = el("div", { class: "emoji-grid" });
        const renderAssets = () =>
            grid.replaceChildren(
                ...(assets.length
                    ? assets.map((asset) =>
                          el(
                              "div",
                              { class: "emoji-item asset-item" },
                              el("img", { src: `${config.cdn}/app-assets/${app.id}/${asset.id}.png?size=160`, alt: "" }),
                              el("span", { title: asset.name }, asset.name),
                              el(
                                  "button",
                                  {
                                      class: "btn secondary",
                                      type: "button",
                                      "aria-label": `Delete ${asset.name}`,
                                      onclick: async () => {
                                          const ok = await confirmDialog({
                                              title: `Delete ${asset.name}?`,
                                              body: "Presences that use this asset name show no image.",
                                              action: "Delete asset",
                                              danger: true,
                                          });
                                          if (!ok) return;
                                          try {
                                              await api("DELETE", `/oauth2/applications/${app.id}/assets/${asset.id}`);
                                              assets.splice(assets.indexOf(asset), 1);
                                              renderAssets();
                                          } catch (e) {
                                              showError(error, e);
                                          }
                                      },
                                  },
                                  "Delete",
                              ),
                          ),
                      )
                    : [el("p", { class: "muted" }, "No assets yet. Upload an image, then use its name as large_image or small_image in your presence.")]),
            );
        renderAssets();
        const upload = el("button", { class: "btn primary", type: "submit" }, "Upload asset");
        const assetsCard = el(
            "form",
            {
                class: "card",
                onsubmit: async (event) => {
                    event.preventDefault();
                    error.hidden = true;
                    nameInput.removeAttribute("aria-invalid");
                    if (!pending) return showError(error, "Choose an image to upload.");
                    if (!nameInput.value.trim()) {
                        nameInput.setAttribute("aria-invalid", "true");
                        nameInput.focus();
                        return showError(error, "Give the asset a name.");
                    }
                    upload.disabled = true;
                    try {
                        const asset = await api("POST", `/oauth2/applications/${app.id}/assets`, { name: nameInput.value.trim(), type: 1, image: await readFile(pending) });
                        assets.push(asset);
                        renderAssets();
                        flash(status, `Uploaded ${asset.name}.`);
                        nameInput.value = "";
                        pending = undefined;
                        fileLabel.textContent = "No image chosen";
                    } catch (e) {
                        if (/name/i.test(e.field ?? "")) nameInput.setAttribute("aria-invalid", "true");
                        showError(error, e);
                    } finally {
                        upload.disabled = false;
                    }
                },
            },
            el("h2", {}, "Rich Presence assets"),
            el("p", { class: "muted" }, "Images your app shows in its Rich Presence, referenced by name. Use at least 512 by 512 pixels."),
            el(
                "div",
                { class: "field-row" },
                el("div", { class: "field" }, el("label", { for: "asset-name" }, "Asset name"), nameInput),
                el(
                    "div",
                    { class: "field" },
                    el("span", { class: "label" }, "Image"),
                    el("div", { class: "media-row compact" }, el("button", { class: "btn secondary", type: "button", onclick: () => fileInput.click() }, "Choose image"), fileLabel),
                    fileInput,
                ),
            ),
            el("div", { class: "actions" }, upload, status),
            error,
            grid,
        );
        return [coverCard, assetsCard];
    };

    const renderTesters = async (app) => {
        const testers = await api("GET", `/oauth2/applications/${app.id}/allowlist`);
        const error = errorLine();
        const status = statusLine();
        const input = el("input", { id: "tester-username", type: "text", maxlength: "37", autocomplete: "off", placeholder: "username" });
        const list = el("ul", { class: "member-list", "aria-label": "Testers" });
        const renderList = () =>
            list.replaceChildren(
                ...(testers.length
                    ? testers.map((tester) => {
                          const src = avatarUrl(tester.user);
                          return el(
                              "li",
                              { class: "member" },
                              src ? el("img", { class: "avatar", src, alt: "" }) : el("span", { class: "avatar", "aria-hidden": "true" }, tester.user.username.charAt(0).toUpperCase()),
                              el("span", { class: "member-name" }, el("strong", {}, tester.user.global_name ?? tester.user.username), el("span", { class: "muted" }, tester.user.username)),
                              el(
                                  "button",
                                  {
                                      class: "btn secondary",
                                      type: "button",
                                      "aria-label": `Remove ${tester.user.username}`,
                                      onclick: async () => {
                                          error.hidden = true;
                                          try {
                                              await api("DELETE", `/oauth2/applications/${app.id}/allowlist/${tester.user.id}`);
                                              testers.splice(testers.indexOf(tester), 1);
                                              renderList();
                                          } catch (e) {
                                              showError(error, e);
                                          }
                                      },
                                  },
                                  "Remove",
                              ),
                          );
                      })
                    : [el("li", { class: "muted" }, "No testers yet.")]),
            );
        renderList();
        const add = el("button", { class: "btn primary", type: "submit" }, "Add tester");
        return [
            el(
                "form",
                {
                    class: "card",
                    onsubmit: async (event) => {
                        event.preventDefault();
                        error.hidden = true;
                        input.removeAttribute("aria-invalid");
                        const username = input.value.trim().replace(/^@/, "");
                        if (!username) {
                            input.setAttribute("aria-invalid", "true");
                            input.focus();
                            return showError(error, "Enter the username of a friend.");
                        }
                        add.disabled = true;
                        try {
                            const [name, discriminator] = username.split("#");
                            const tester = await api("POST", `/oauth2/applications/${app.id}/allowlist`, { username: name, ...(discriminator && { discriminator }) });
                            if (!testers.some((entry) => entry.user.id === tester.user.id)) testers.push(tester);
                            renderList();
                            input.value = "";
                            flash(status, `Added ${tester.user.username}.`);
                        } catch (e) {
                            input.setAttribute("aria-invalid", "true");
                            showError(error, e);
                        } finally {
                            add.disabled = false;
                        }
                    },
                },
                el("h2", {}, "App testers"),
                el("p", { class: "muted" }, "Testers can launch your activity before you release it to everyone. You can add up to 50 of your friends."),
                el("div", { class: "field" }, el("label", { for: "tester-username" }, "Username"), el("div", { class: "copy-row" }, input, add)),
                status,
                error,
                list,
            ),
        ];
    };

    const renderActivities = async (app) => {
        const error = errorLine();
        if (!(app.flags & FLAGS.embedded)) {
            const enable = el(
                "button",
                {
                    class: "btn primary",
                    type: "button",
                    onclick: async () => {
                        enable.disabled = true;
                        error.hidden = true;
                        try {
                            Object.assign(app, await api("PATCH", `/applications/${app.id}`, { flags: app.flags | FLAGS.embedded }));
                            await render();
                        } catch (e) {
                            showError(error, e);
                            enable.disabled = false;
                        }
                    },
                },
                "Enable activities",
            );
            return [
                el(
                    "section",
                    { class: "card" },
                    el("h2", {}, "Activities"),
                    el(
                        "p",
                        { class: "muted" },
                        "Activities are web apps people launch together in voice channels and DMs. Enabling them gives your app a Launch command and an address that serves your web app inside the client.",
                    ),
                    enable,
                    error,
                ),
            ];
        }

        const [activityConfig, proxy] = await Promise.all([api("GET", `/applications/${app.id}/embedded-activity-config`), api("GET", `/applications/${app.id}/proxy-config`)]);
        const host = `${location.protocol}//${app.id}.${config.activityHost || location.host}`;

        const releaseError = errorLine();
        const settingsStatus = statusLine();
        const settingsError = errorLine();
        const platforms = Object.fromEntries(
            [
                ["web", "Web and desktop"],
                ["ios", "iOS"],
                ["android", "Android"],
            ].map(([platform, label]) => [platform, [el("input", { type: "checkbox", checked: activityConfig.supported_platforms?.includes(platform) }), label]]),
        );
        const ageGate = el("input", { id: "activity-age-gate", type: "checkbox", checked: activityConfig.requires_age_gate === true });
        const saveSettings = el("button", { class: "btn primary", type: "submit" }, "Save changes");
        const settingsCard = el(
            "form",
            {
                class: "card",
                onsubmit: async (event) => {
                    event.preventDefault();
                    settingsError.hidden = true;
                    const supported_platforms = Object.entries(platforms)
                        .filter(([, [box]]) => box.checked)
                        .map(([platform]) => platform);
                    if (!supported_platforms.length) return showError(settingsError, "Pick at least one platform.");
                    saveSettings.disabled = true;
                    try {
                        await api("PATCH", `/applications/${app.id}/embedded-activity-config`, { supported_platforms, requires_age_gate: ageGate.checked });
                        flash(settingsStatus, "Changes saved.");
                    } catch (e) {
                        showError(settingsError, e);
                    } finally {
                        saveSettings.disabled = false;
                    }
                },
            },
            el("h2", {}, "Activity settings"),
            el("p", { class: "muted" }, "Your activity loads from this address, which serves the root URL mapping below."),
            el(
                "div",
                { class: "fields" },
                el("div", { class: "field" }, el("label", { for: "activity-host" }, "Activity URL"), el("div", { class: "copy-row" }, el("input", { id: "activity-host", type: "text", readonly: true, value: host }), copyButton(() => host))),
                switchRow(
                    "activity-release",
                    "Release to everyone",
                    "When this is off, only you and your app testers can start the activity. Anyone in the channel can still join a session that's already running.",
                    flagToggle(app, "activity-release", FLAGS.embeddedReleased, releaseError),
                ),
                releaseError,
                el(
                    "div",
                    { class: "check-group" },
                    el("h3", {}, "Supported platforms"),
                    el(
                        "div",
                        { class: "check-grid" },
                        Object.values(platforms).map(([box, label]) => el("label", { class: "check" }, box, label)),
                    ),
                ),
                switchRow("activity-age-gate", "Age-restricted activity", "Only people who are 18 or older can launch it.", ageGate),
            ),
            el("div", { class: "actions" }, saveSettings, settingsStatus),
            settingsError,
        );

        const byRoot = (a, b) => (a.prefix === "/" ? -1 : b.prefix === "/" ? 1 : 0);
        const mappings = proxy.url_map.map((mapping) => ({ ...mapping }));
        if (!mappings.some((mapping) => mapping.prefix === "/")) mappings.unshift({ prefix: "/", target: "" });
        mappings.sort(byRoot);
        const mappingList = el("div", { class: "fields" });
        const mappingStatus = statusLine();
        const mappingError = errorLine();
        const renderMappings = () =>
            mappingList.replaceChildren(
                ...mappings.map((mapping, index) => {
                    const root = index === 0;
                    const prefix = el("input", { id: `mapping-prefix-${index}`, type: "text", value: mapping.prefix, readonly: root, placeholder: "/api", oninput: () => (mapping.prefix = prefix.value) });
                    const target = el("input", {
                        id: `mapping-target-${index}`,
                        type: "text",
                        inputmode: "url",
                        value: mapping.target,
                        placeholder: root ? "app.example.com" : "api.example.com",
                        oninput: () => (mapping.target = target.value),
                    });
                    return el(
                        "div",
                        { class: "mapping-row" },
                        el("div", { class: "field" }, el("label", { for: `mapping-prefix-${index}` }, root ? "Root prefix" : "Prefix"), prefix),
                        el("div", { class: "field" }, el("label", { for: `mapping-target-${index}` }, "Target"), target),
                        root
                            ? el("span", { class: "mapping-spacer", "aria-hidden": "true" })
                            : el(
                                  "button",
                                  {
                                      class: "btn secondary",
                                      type: "button",
                                      "aria-label": `Remove the ${mapping.prefix || "new"} mapping`,
                                      onclick: () => {
                                          mappings.splice(index, 1);
                                          renderMappings();
                                      },
                                  },
                                  "Remove",
                              ),
                    );
                }),
            );
        renderMappings();
        const saveMappings = el("button", { class: "btn primary", type: "submit" }, "Save changes");
        const mappingsCard = el(
            "form",
            {
                class: "card",
                onsubmit: async (event) => {
                    event.preventDefault();
                    mappingError.hidden = true;
                    mappingList.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
                    const url_map = mappings.map(({ prefix, target }) => ({ prefix: prefix.trim(), target: target.trim() }));
                    const blank = url_map.findIndex(({ prefix, target }) => !prefix || !target);
                    if (blank !== -1) {
                        const input = document.getElementById(`mapping-${url_map[blank].prefix ? "target" : "prefix"}-${blank}`);
                        input.setAttribute("aria-invalid", "true");
                        input.focus();
                        return showError(mappingError, blank === 0 ? "Enter the domain your activity is served from." : "Fill in both fields or remove the mapping.");
                    }
                    saveMappings.disabled = true;
                    try {
                        const saved = await api("PUT", `/applications/${app.id}/proxy-config`, { url_map });
                        mappings.splice(0, mappings.length, ...saved.url_map.map((mapping) => ({ ...mapping })));
                        mappings.sort(byRoot);
                        renderMappings();
                        flash(mappingStatus, "Changes saved.");
                    } catch (e) {
                        const [, index, key] = /url_map\.(\d+)\.(prefix|target)/.exec(e.field ?? "") ?? [];
                        const input = index && document.getElementById(`mapping-${key}-${index}`);
                        if (input) {
                            input.setAttribute("aria-invalid", "true");
                            input.focus();
                        }
                        showError(mappingError, e);
                    } finally {
                        saveMappings.disabled = false;
                    }
                },
            },
            el("h2", {}, "URL mappings"),
            el(
                "p",
                { class: "muted" },
                "Your activity can only load content through its own address. Map path prefixes to the domains that serve them, without https://. The longest matching prefix wins.",
            ),
            mappingList,
            el(
                "div",
                { class: "actions" },
                el(
                    "button",
                    {
                        class: "btn secondary",
                        type: "button",
                        onclick: () => {
                            mappings.push({ prefix: "", target: "" });
                            renderMappings();
                            document.getElementById(`mapping-prefix-${mappings.length - 1}`)?.focus();
                        },
                    },
                    "Add mapping",
                ),
                saveMappings,
                mappingStatus,
            ),
            mappingError,
        );

        const disableError = errorLine();
        const disable = el(
            "button",
            {
                class: "btn danger",
                type: "button",
                onclick: async () => {
                    const ok = await confirmDialog({
                        title: "Disable activities?",
                        body: "People can no longer launch your activity, and running sessions stop loading. Your settings and URL mappings are kept.",
                        action: "Disable activities",
                        danger: true,
                    });
                    if (!ok) return;
                    try {
                        Object.assign(app, await api("PATCH", `/applications/${app.id}`, { flags: app.flags & ~(FLAGS.embedded | FLAGS.embeddedReleased) }));
                        await render();
                    } catch (e) {
                        showError(disableError, e);
                    }
                },
            },
            "Disable activities",
        );
        const disableCard = el("section", { class: "card" }, el("h2", {}, "Disable activities"), el("p", { class: "muted" }, "Turn activities off without losing your settings."), disable, disableError);
        return [settingsCard, mappingsCard, disableCard];
    };

    const SECTIONS = {
        information: ["General information", renderInformation],
        installation: ["Installation", renderInstallation],
        oauth2: ["OAuth2", renderOAuth],
        bot: ["Bot", renderBot],
        emojis: ["Emojis", renderEmojis],
        "rich-presence": ["Rich Presence", renderRichPresence],
        testers: ["App Testers", renderTesters],
        activities: ["Activities", renderActivities],
    };

    const renderApp = async (id, section) => {
        if (!SECTIONS[section]) return navigate(`/developers/applications/${id}/information`, true);
        view.replaceChildren(el("p", { class: "loading" }, "Loading application"));
        let app;
        try {
            app = await api("GET", `/applications/${id}`);
        } catch (e) {
            setNav(null);
            view.replaceChildren(
                el(
                    "div",
                    { class: "empty" },
                    el("h2", {}, "Application not found"),
                    el("p", { class: "muted" }, e.message),
                    el("a", { class: "btn primary", href: "/developers/applications", "data-link": true }, "Go to your applications"),
                ),
            );
            return;
        }
        const [title, renderSection] = SECTIONS[section];
        setNav(app, section);
        document.title = `${title} | ${app.name} | ${config.instanceName} Developer Portal`;
        view.replaceChildren(el("div", { class: "page-head app-head" }, el("h1", {}, app.name)), ...(await renderSection(app)));
    };

    const render = async () => {
        const path = location.pathname.replace(/\/+$/, "");
        const match = path.match(/^\/developers\/applications\/(\d+)(?:\/([\w-]+))?$/);
        try {
            if (match) await renderApp(match[1], match[2] ?? "information");
            else if (path === "/developers/applications") await renderList();
            else navigate("/developers/applications", true);
        } catch (e) {
            view.replaceChildren(el("div", { class: "empty" }, el("h2", {}, "Something went wrong"), el("p", { class: "error", role: "alert" }, e.message)));
        }
        view.focus({ preventScroll: true });
    };

    render();
})();
