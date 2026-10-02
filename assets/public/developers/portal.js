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
        if (!res.ok) throw new Error(errorText(data, res.status));
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
                            ...(icon && { icon }),
                        });
                        Object.assign(app, updated);
                        icon = undefined;
                        setNav(app, "information");
                        flash(status, "Changes saved.");
                    } catch (e) {
                        if (/endpoint/i.test(e.message)) {
                            endpoint.setAttribute("aria-invalid", "true");
                            endpoint.focus();
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
        const publicCard = el(
            "section",
            { class: "card" },
            el(
                "div",
                { class: "switch-row" },
                el("div", {}, el("label", { for: "bot-public" }, "Let anyone add this bot"), el("p", { class: "hint" }, "When this is off, only you can add the bot to servers.")),
                publicToggle,
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
        const scopes = { bot: el("input", { type: "checkbox", checked: true }), "applications.commands": el("input", { type: "checkbox", checked: true }) };
        const { groups, boxes: permissionBoxes, value: permissionValue } = permissionPicker();
        const permissionsCard = el("section", { class: "card" }, el("h2", {}, "Bot permissions"), el("p", { class: "muted" }, "The bot gets a role with these permissions in each server it joins."), groups);
        const output = el("input", { id: "oauth-url", type: "text", readonly: true });
        const open = el("a", { class: "btn primary", target: "_blank", rel: "noopener" }, "Open invite link");
        const permissionsValue = el("input", { id: "oauth-permissions", type: "text", readonly: true });
        const update = () => {
            const chosen = Object.entries(scopes)
                .filter(([, box]) => box.checked)
                .map(([scope]) => scope);
            const bits = permissionValue();
            permissionsCard.hidden = !scopes.bot.checked;
            const params = new URLSearchParams({ client_id: app.id });
            if (scopes.bot.checked) params.set("permissions", bits.toString());
            params.set("integration_type", "0");
            params.set("scope", chosen.join(" "));
            const url = `${location.origin}/oauth2/authorize?${params}`;
            output.value = chosen.length ? url : "";
            permissionsValue.value = bits.toString();
            open.href = url;
            open.toggleAttribute("aria-disabled", !chosen.length);
            open.hidden = !chosen.length;
        };
        [...Object.values(scopes), ...permissionBoxes].forEach((box) => box.addEventListener("change", update));
        const scopesCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Invite link generator"),
            el("p", { class: "muted" }, "Pick what your application needs, then share the link with the people who manage the servers it should join."),
            el(
                "div",
                { class: "check-grid" },
                Object.entries(scopes).map(([scope, box]) => el("label", { class: "check" }, box, scope)),
            ),
        );
        const outputCard = el(
            "section",
            { class: "card" },
            el("h2", {}, "Generated link"),
            el(
                "div",
                { class: "fields" },
                el("div", { class: "field" }, el("label", { for: "oauth-url" }, "Invite link"), el("div", { class: "copy-row" }, output, copyButton(() => output.value))),
                el("div", { class: "field" }, el("label", { for: "oauth-permissions" }, "Permissions integer"), el("div", { class: "copy-row" }, permissionsValue, copyButton(() => permissionsValue.value))),
            ),
            el("div", { class: "actions" }, open),
        );
        update();
        return [scopesCard, permissionsCard, outputCard];
    };

    const SECTIONS = {
        information: ["General information", renderInformation],
        installation: ["Installation", renderInstallation],
        oauth2: ["OAuth2", renderOAuth],
        bot: ["Bot", renderBot],
        emojis: ["Emojis", renderEmojis],
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
        const match = path.match(/^\/developers\/applications\/(\d+)(?:\/(\w+))?$/);
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
