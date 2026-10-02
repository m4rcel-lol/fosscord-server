"use strict";

/* ---------- tiny helpers ---------- */

const API = "/api/v9";
const SNOWFLAKE_EPOCH = 1420070400000n;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// everything interpolated into html`` is escaped unless wrapped in raw()
class Raw {
    constructor(value) {
        this.value = value;
    }
}
const raw = (value) => new Raw(value);
const escapeHtml = (value) =>
    String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
const renderValue = (value) => {
    if (value instanceof Raw) return value.value;
    if (Array.isArray(value)) return value.map(renderValue).join("");
    if (value === false || value === null || value === undefined) return "";
    return escapeHtml(value);
};
const html = (strings, ...values) => raw(strings.reduce((out, str, i) => out + str + (i < values.length ? renderValue(values[i]) : ""), ""));
const mount = (el, content) => {
    el.innerHTML = renderValue(content);
    return el;
};

const snowflakeDate = (id) => {
    try {
        return new Date(Number((BigInt(id) >> 22n) + SNOWFLAKE_EPOCH));
    } catch {
        return null;
    }
};
const fmtDate = (value) => {
    const d = value instanceof Date ? value : value ? new Date(value) : null;
    return d && !isNaN(d) ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
};
const fmtDay = (value) => {
    const d = value instanceof Date ? value : value ? new Date(value) : null;
    return d && !isNaN(d) ? d.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
};
const fmtNumber = (n) => Number(n ?? 0).toLocaleString();
const fmtDuration = (seconds) => {
    const s = Math.floor(seconds);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};
// datetime-local inputs work in local time without a zone
const toLocalInput = (value) => {
    if (!value) return "";
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

const debounce = (fn, ms = 250) => {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
};

const toast = (message, kind = "ok") => {
    const el = document.createElement("div");
    el.className = `toast ${kind === "error" ? "error" : ""}`;
    el.textContent = message;
    $("#toasts").append(el);
    setTimeout(() => el.remove(), kind === "error" ? 6000 : 3000);
};

const userName = (u) => (u ? u.global_name || u.username || u.id : "—");
const userTag = (u) => (u ? (u.discriminator && u.discriminator !== "0" ? `${u.username}#${u.discriminator}` : `@${u.username}`) : "");

const initials = (name) =>
    String(name || "?")
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

const avatar = (u, cls = "") =>
    u?.avatar
        ? html`<img class="avatar ${cls}" src="/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}?size=128" alt="" loading="lazy" />`
        : html`<span class="avatar ${cls}">${initials(userName(u))}</span>`;

// a server tag the way it looks next to a name: badge icon + tag text
const tagChip = (guildId, tag, badgeHash) =>
    html`<span class="tag-chip small">${badgeHash ? html`<img src="/clan-badges/${guildId}/${badgeHash}.png?size=32" alt="" />` : ""}${tag}</span>`;

const guildIcon = (g, cls = "") =>
    g?.icon
        ? html`<img class="avatar square ${cls}" src="/icons/${g.id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "png"}?size=128" alt="" loading="lazy" />`
        : html`<span class="avatar square ${cls}">${initials(g?.name)}</span>`;

/* ---------- auth + api ---------- */

const auth = {
    get token() {
        try {
            const own = localStorage.getItem("admin_token");
            if (own) return own;
            // reuse the web client's session on the same origin, unless the dashboard was explicitly signed out of
            if (sessionStorage.getItem("admin_skip_client")) return null;
            const client = localStorage.getItem("token");
            return client ? JSON.parse(client) : null;
        } catch {
            return null;
        }
    },
    set(token) {
        try {
            localStorage.setItem("admin_token", token);
            sessionStorage.removeItem("admin_skip_client");
        } catch {
            /* storage blocked: the session just won't survive a reload */
        }
        this.memory = token;
    },
    clear({ skipClient = false } = {}) {
        try {
            localStorage.removeItem("admin_token");
            if (skipClient) sessionStorage.setItem("admin_skip_client", "1");
        } catch {
            /* ignore */
        }
        this.memory = null;
    },
    memory: null,
};
const currentToken = () => auth.memory || auth.token;

class ApiError extends Error {
    constructor(status, body) {
        super(describeError(body) || `Request failed (${status})`);
        this.status = status;
        this.body = body;
    }
}

function describeError(body) {
    if (!body || typeof body !== "object") return null;
    const fieldErrors = [];
    const walk = (node, path) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node._errors)) node._errors.forEach((e) => fieldErrors.push(`${path}: ${e.message}`));
        for (const [k, v] of Object.entries(node)) if (k !== "_errors") walk(v, path ? `${path}.${k}` : k);
    };
    walk(body.errors, "");
    return fieldErrors.length ? fieldErrors.join("; ") : body.message;
}

async function api(path, { method = "GET", body, auth: useAuth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (useAuth && currentToken()) headers.Authorization = currentToken();
    const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { message: text };
    }
    if (res.status === 401 && useAuth) {
        auth.clear();
        showLogin("Your session expired. Sign in again.");
        throw new ApiError(res.status, data);
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
}

// run an action, surfacing errors as toasts and disabling the trigger meanwhile
async function act(button, fn, success) {
    if (button) button.disabled = true;
    try {
        const result = await fn();
        if (success) toast(success);
        return result;
    } catch (e) {
        if (e.status !== 401) toast(e.message, "error");
        return undefined;
    } finally {
        if (button) button.disabled = false;
    }
}

/* ---------- constants ---------- */

const RIGHTS = [
    ["OPERATOR", 0, "Full access to everything"],
    ["MANAGE_GUILDS", 2, "Manage every server"],
    ["MANAGE_MESSAGES", 3, "Edit/delete any visible message"],
    ["MANAGE_USERS", 7, "Manage users from this dashboard"],
    ["BYPASS_RATE_LIMITS", 9, "Not rate limited"],
    ["CREATE_GUILDS", 14, "Create servers"],
    ["CREATE_INVITES", 15, "Create mass invites"],
    ["JOIN_GUILDS", 19, "Join servers"],
    ["SELF_ADD_REACTIONS", 21, "Add reactions"],
    ["SELF_DELETE_MESSAGES", 22, "Delete own messages"],
    ["SELF_EDIT_MESSAGES", 23, "Edit own messages"],
    ["SEND_MESSAGES", 25, "Send messages"],
    ["KICK_BAN_MEMBERS", 33, "Kick/ban in servers they moderate"],
    ["SELF_LEAVE_GROUPS", 34, "Leave group DMs"],
    ["PRESENCE", 35, "Presence routing override"],
    ["SEND_BACKDATED_EVENTS", 42, "Send backdated events"],
    ["USE_MASS_INVITES", 43, "Accept mass invites"],
];
const hasRight = (rights, bit) => {
    try {
        return (BigInt(rights || 0) & (1n << BigInt(bit))) !== 0n;
    } catch {
        return false;
    }
};

const PREMIUM_TYPES = [
    [0, "None"],
    [1, "Nitro Classic"],
    [2, "Nitro"],
    [3, "Nitro Basic"],
];

const GUILD_FEATURES = [
    "VERIFIED",
    "PARTNERED",
    "DISCOVERABLE",
    "COMMUNITY",
    "NEWS",
    "VANITY_URL",
    "INVITE_SPLASH",
    "BANNER",
    "ANIMATED_ICON",
    "ANIMATED_BANNER",
    "WELCOME_SCREEN_ENABLED",
    "MEMBER_VERIFICATION_GATE_ENABLED",
    "PREVIEW_ENABLED",
    "ROLE_ICONS",
    "INTERNAL_EMPLOYEE_ONLY",
];

const USER_TAGS = [
    ["none", "No tag", "Bot accounts still show the regular BOT tag."],
    ["verified_bot", "Verified Bot", "The blurple ✓ BOT tag. Only shows on bot accounts."],
    ["ai", "AI", "The green AI tag, for any account."],
    ["verified_ai", "Verified AI", "The green ✓ AI tag, for any account."],
];

// mirrors how the patched web client draws the tag next to a name
const nameTag = (tag, isBot) => {
    const verified = tag === "verified_bot" || tag === "verified_ai";
    const ai = tag === "ai" || tag === "verified_ai";
    if (!ai && !isBot) return html`<span class="muted">no tag</span>`;
    return html`<span class="name-tag ${ai ? "ai" : ""}" title="${verified ? (ai ? "Verified AI" : "Verified Bot") : ""}">${verified ? raw(CHECK_ICON) : ""}${ai ? "AI" : "BOT"}</span>`;
};
const CHECK_ICON = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M18.7 7.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l3.3 3.29 7.3-7.3a1 1 0 0 1 1.4 0Z"/></svg>';

const badgeIcon = (b) => html`<img class="badge-icon" src="/badge-icons/${b.icon}.png" alt="" loading="lazy" />`;

const STANDINGS = [
    [100, "All good", "ok"],
    [200, "Limited", "warn"],
    [300, "Very limited", "warn"],
    [400, "At risk", "danger"],
    [500, "Suspended", "danger"],
];
const standingOf = (state) => STANDINGS.find(([v]) => v === state) ?? STANDINGS[0];

const VIOLATION_TYPES = [
    [3030, "Spam"],
    [290, "Harassment and bullying"],
    [320, "Hateful conduct"],
    [220, "Hate speech"],
    [210, "Glorifying violence"],
    [3010, "Malicious conduct"],
    [711, "Impersonation"],
    [720, "Ban evasion"],
    [4010, "Fraud"],
    [250, "Social engineering"],
    [240, "Illicit goods"],
    [230, "Cracked accounts"],
    [100, "Unsolicited adult content"],
    [4000, "Non-consensual adult content"],
    [5305, "Doxxing"],
    [5440, "Copyright infringement"],
    [280, "Child safety"],
    [5090, "Self-harm"],
    [5411, "Underage user"],
    [1, "Other"],
];
const violationType = (id) => VIOLATION_TYPES.find(([v]) => v === id)?.[1] ?? `Type ${id}`;

const VIOLATION_ACTIONS = [
    [4, "Warning"],
    [9, "Limited access"],
    [1, "Temporary ban"],
    [0, "Ban"],
    [2, "Quarantine"],
    [3, "Verification required"],
    [13, "Content removed"],
    [16, "Messages removed"],
    [14, "Username reset"],
    [22, "Profile reset"],
    [5, "Marked as spammer"],
];
const APPEAL_REASONS = ["They didn't break the rules", "The decision was too strict or unfair", "They disagree with the penalty", "Something else"];

const violationAction = (id) => VIOLATION_ACTIONS.find(([v]) => v === id)?.[1] ?? `Action ${id}`;

const VIOLATION_DURATIONS = [
    [7, "7 days"],
    [30, "30 days"],
    [90, "90 days"],
    [180, "180 days"],
    [365, "1 year"],
    ["", "Permanent"],
];

const COMPONENT_STATUSES = [
    ["operational", "Operational", "ok"],
    ["degraded_performance", "Degraded performance", "warn"],
    ["partial_outage", "Partial outage", "warn"],
    ["major_outage", "Major outage", "danger"],
    ["under_maintenance", "Under maintenance", "info"],
];
const componentStatus = (key) => COMPONENT_STATUSES.find(([k]) => k === key) ?? COMPONENT_STATUSES[0];

const IMPACTS = [
    ["none", "None", ""],
    ["minor", "Minor", "warn"],
    ["major", "Major", "danger"],
    ["critical", "Critical", "danger"],
];
const INCIDENT_STATES = [
    ["investigating", "Investigating"],
    ["identified", "Identified"],
    ["monitoring", "Monitoring"],
    ["resolved", "Resolved"],
];
const MAINTENANCE_STATES = [
    ["scheduled", "Scheduled"],
    ["in_progress", "In progress"],
    ["verifying", "Verifying"],
    ["completed", "Completed"],
];
const RESOLVED = ["resolved", "completed"];
const stateLabel = (key) => [...INCIDENT_STATES, ...MAINTENANCE_STATES].find(([k]) => k === key)?.[1] ?? key;
const stateBadge = (key) => html`<span class="badge ${RESOLVED.includes(key) ? "ok" : key === "scheduled" ? "info" : "warn"}">${stateLabel(key)}</span>`;
const impactBadge = (incident) =>
    incident.impact === "maintenance"
        ? html`<span class="badge info">Maintenance</span>`
        : html`<span class="badge ${IMPACTS.find(([k]) => k === incident.impact)?.[2] ?? ""}">${IMPACTS.find(([k]) => k === incident.impact)?.[1] ?? incident.impact} impact</span>`;

const options = (list, selected) => list.map(([value, label]) => html`<option value="${value}" ${String(value) === String(selected) ? raw("selected") : ""}>${label}</option>`);

/* ---------- shell ---------- */

const state = { overview: null, me: null };

function showLogin(message) {
    $("#app").hidden = true;
    $("#login").hidden = false;
    const err = $("#login-error");
    err.hidden = !message;
    err.textContent = message || "";
}

async function boot() {
    if (!currentToken()) return showLogin();
    try {
        const [overview, me] = await Promise.all([api("/admin"), api("/users/@me")]);
        state.overview = overview;
        state.me = me;
    } catch (e) {
        if (e.status === 401) return;
        if (e.status === 403 || e.body?.code === 50013) {
            auth.clear();
            return showLogin("This account doesn't have admin rights on this instance.");
        }
        return showLogin(e.message);
    }

    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#brand-name").textContent = state.overview.instance.name;
    if (state.overview.instance.image) $("#brand-icon").src = state.overview.instance.image;
    mount($("#me"), html`${avatar(state.me)}<div class="ident"><div><strong>${userName(state.me)}</strong><span class="muted">${userTag(state.me)}</span></div></div>`);
    for (const link of $$("#nav a")) link.hidden = link.dataset.access ? !state.overview.access[link.dataset.access] : false;
    route();
}

$("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = $("button[type=submit]", form);
    const data = Object.fromEntries(new FormData(form));
    const err = $("#login-error");
    err.hidden = true;
    button.disabled = true;
    try {
        let result;
        if (form.dataset.ticket) result = await api("/auth/mfa/totp", { method: "POST", body: { code: data.code, ticket: form.dataset.ticket }, auth: false });
        else result = await api("/auth/login", { method: "POST", body: { login: data.login, password: data.password, undelete: false }, auth: false });

        if (result.mfa && result.ticket) {
            form.dataset.ticket = result.ticket;
            $("#mfa-field").hidden = false;
            $("#mfa-field input").required = true;
            $("#mfa-field input").focus();
            return;
        }
        if (!result.token) throw new Error("This account needs a sign-in method this page doesn't support (security key).");
        auth.set(result.token);
        delete form.dataset.ticket;
        form.reset();
        $("#mfa-field").hidden = true;
        await boot();
    } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
    } finally {
        button.disabled = false;
    }
});

$("#logout").addEventListener("click", () => {
    // only drops the dashboard's session; the web client stays signed in
    auth.clear({ skipClient: true });
    state.overview = null;
    showLogin();
});

/* ---------- router ---------- */

const TABS = {
    overview: renderOverview,
    settings: renderSettings,
    users: renderUsers,
    badges: renderBadges,
    announcements: renderAnnouncements,
    guilds: renderGuilds,
    status: renderStatus,
};

function route() {
    if (!state.overview) return;
    let [tab] = location.hash.replace(/^#\/?/, "").split("/");
    const link = $(`#nav a[data-tab="${CSS.escape(tab || "")}"]`);
    if (!TABS[tab] || !link || link.hidden) tab = "overview";
    for (const a of $$("#nav a")) a.classList.toggle("active", a.dataset.tab === tab);
    closeDrawer();
    const view = $("#view");
    mount(view, html`<div class="spinner">Loading…</div>`);
    TABS[tab](view).catch((e) => {
        if (e.status !== 401) mount(view, html`<div class="card"><h2>Something went wrong</h2><p class="muted">${e.message}</p></div>`);
    });
}
window.addEventListener("hashchange", route);

/* ---------- drawer ---------- */

function openDrawer(title, content) {
    $("#drawer-title").textContent = title;
    mount($("#drawer-body"), content);
    $("#drawer").hidden = false;
    return $("#drawer-body");
}
function closeDrawer() {
    $("#drawer").hidden = true;
    $("#drawer-body").innerHTML = "";
}
$("#drawer").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeDrawer();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
});

/* ---------- overview ---------- */

async function renderOverview(view) {
    const o = await api("/admin");
    state.overview = o;
    const status = await api("/status/summary.json", { auth: false }).catch(() => null);
    const stat = (label, value, href) => html`
        <a class="card stat" ${href ? raw(`href="${escapeHtml(href)}"`) : ""} style="text-decoration:none;color:inherit">
            <div class="muted">${label}</div>
            <div class="value">${value}</div>
        </a>
    `;

    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>${o.instance.name}</h1>
                    <p class="muted">${o.instance.description || "No description set."}</p>
                </div>
                ${o.access.settings ? html`<a class="btn" href="#/settings">Edit site settings</a>` : ""}
            </div>
            <div class="stack">
                <div class="stats">
                    ${stat("Users", fmtNumber(o.counts.users), o.access.users ? "#/users" : null)}
                    ${stat("Servers", fmtNumber(o.counts.guilds), o.access.guilds ? "#/guilds" : null)}
                    ${stat("Messages", fmtNumber(o.counts.messages))}
                    ${stat("Memberships", fmtNumber(o.counts.members))}
                    ${stat("Disabled accounts", fmtNumber(o.counts.disabled_users), o.access.users ? "#/users" : null)}
                    ${stat("Open incidents", fmtNumber(o.counts.open_incidents), o.access.status ? "#/status" : null)}
                </div>
                <div class="card">
                    <h3>Instance</h3>
                    <div class="list">
                        <div class="list-item"><span class="grow muted">Public status</span>${status ? html`<span class="badge ${status.status.indicator === "none" ? "ok" : status.status.indicator === "maintenance" ? "info" : "warn"}"><span class="dot"></span>${status.status.description}</span>` : "—"}</div>
                        <div class="list-item"><span class="grow muted">Uptime</span><span>${fmtDuration(o.uptime)}</span></div>
                        <div class="list-item"><span class="grow muted">Revision</span><code>${o.revision?.rev?.slice(0, 10) ?? "unknown"}</code></div>
                        <div class="list-item"><span class="grow muted">Instance ID</span><code>${o.instance.id}</code></div>
                        <div class="list-item"><span class="grow muted">Your access</span><span class="badges">${Object.entries(o.access)
                            .filter(([k, v]) => v && k !== "operator")
                            .map(([k]) => html`<span class="badge accent">${k}</span>`)}</span></div>
                    </div>
                </div>
            </div>
        `,
    );
}

/* ---------- settings ---------- */

async function renderSettings(view) {
    const s = await api("/admin/settings");
    const text = (section, key, label, hint, type = "text") =>
        html`<label>${label}${hint ? html`<span class="hint">${hint}</span>` : ""}<input type="${type}" name="${section}.${key}" value="${s[section][key] ?? ""}" /></label>`;
    const toggle = (key, label, hint) =>
        html`<label class="toggle"><input type="checkbox" name="register.${key}" ${s.register[key] ? raw("checked") : ""} /><span>${label}<span class="hint">${hint}</span></span></label>`;

    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>Site settings</h1>
                    <p class="muted">Instance information shown to users and clients, and who can sign up.</p>
                </div>
            </div>
            <form id="settings-form" class="stack">
                <div class="card">
                    <h2>Instance information</h2>
                    <div class="form-grid">
                        <label>Instance name<input name="general.instanceName" value="${s.general.instanceName}" required maxlength="100" /></label>
                        ${text("general", "image", "Icon URL", "Square image shown in the dashboard and to clients", "url")}
                        <label class="span"
                            >Description<textarea name="general.instanceDescription" maxlength="1000">${s.general.instanceDescription ?? ""}</textarea></label
                        >
                        ${text("general", "frontPage", "Homepage URL", "Linked from the status page", "url")}
                        ${text("general", "tosPage", "Terms of service URL", "Opened from every Terms of Service link in the client", "url")}
                        ${text("general", "privacyPage", "Privacy policy URL", "Falls back to the terms of service URL", "url")}
                        ${text("general", "guidelinesPage", "Community guidelines URL", "Falls back to the terms of service URL", "url")}
                        ${text("general", "correspondenceEmail", "Contact email", "", "email")}
                        ${text("general", "correspondenceUserID", "Contact user ID", "The account users can message for help")}
                    </div>
                </div>
                <div class="card">
                    <h2>Registration</h2>
                    <div class="stack">
                        ${toggle("disabled", "Disable registration entirely", "Nobody can create an account, including with an invite.")}
                        ${toggle("allowNewRegistration", "Allow new registrations", "Turn off to stop new sign-ups while keeping invite-based registration rules.")}
                        ${toggle("requireInvite", "Require an invite to register", "New accounts must join through an invite link.")}
                        ${toggle("requireCaptcha", "Require a captcha", "Only applies when a captcha service is configured.")}
                        ${toggle("allowMultipleAccounts", "Allow multiple accounts per person", "When off, sign-ups from known devices/IPs are refused.")}
                    </div>
                </div>
                <div class="form-actions">
                    <button class="btn" type="reset">Discard changes</button>
                    <button class="btn primary" type="submit">Save settings</button>
                </div>
            </form>
        `,
    );

    $("#settings-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const body = { general: {}, register: {} };
        for (const el of $$("input, textarea", form)) {
            const [section, key] = el.name.split(".");
            body[section][key] = el.type === "checkbox" ? el.checked : el.value;
        }
        const saved = await act($("button[type=submit]", form), () => api("/admin/settings", { method: "PATCH", body }), "Settings saved");
        if (saved) {
            $("#brand-name").textContent = saved.general.instanceName;
            if (saved.general.image) $("#brand-icon").src = saved.general.image;
            renderSettings(view);
        }
    });
}

/* ---------- users ---------- */

const usersState = { q: "", filter: "all", offset: 0, limit: 50 };

async function renderUsers(view) {
    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>Users</h1>
                    <p class="muted">Search by name, email or ID. Click a user to edit or ban them.</p>
                </div>
            </div>
            <div class="row" style="margin-bottom:12px">
                <input class="grow" id="user-search" type="search" placeholder="Search users…" value="${usersState.q}" style="max-width:420px" />
                <select id="user-filter" style="width:auto">
                    ${options(
                        [
                            ["all", "All users"],
                            ["disabled", "Disabled"],
                            ["verified", "Verified email"],
                            ["unverified", "Unverified email"],
                            ["bots", "Bots"],
                        ],
                        usersState.filter,
                    )}
                </select>
            </div>
            <div id="user-results"><div class="spinner">Loading…</div></div>
        `,
    );

    const load = async () => {
        const params = new URLSearchParams({ q: usersState.q, filter: usersState.filter, limit: usersState.limit, offset: usersState.offset });
        const { users, total } = await api(`/admin/users?${params}`);
        const results = $("#user-results");
        if (!results) return;
        mount(
            results,
            users.length
                ? html`
                      <div class="table-wrap">
                          <table>
                              <thead>
                                  <tr>
                                      <th>User</th>
                                      <th class="hide-sm">Email</th>
                                      <th class="hide-sm">Joined</th>
                                      <th>Flags</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${users.map(
                                      (u) => html`
                                          <tr data-id="${u.id}">
                                              <td>
                                                  <div class="ident">
                                                      ${avatar(u)}
                                                      <div><strong>${userName(u)}</strong><span class="muted">${userTag(u)}</span></div>
                                                  </div>
                                              </td>
                                              <td class="hide-sm">${u.email || html`<span class="muted">—</span>`}</td>
                                              <td class="hide-sm">${fmtDay(u.created_at)}</td>
                                              <td>${userBadges(u)}</td>
                                          </tr>
                                      `,
                                  )}
                              </tbody>
                          </table>
                      </div>
                      ${pager(total, usersState)}
                  `
                : html`<div class="card empty">No users match.</div>`,
        );
        for (const row of $$("tbody tr", results)) row.addEventListener("click", () => openUser(row.dataset.id, load));
        bindPager(results, total, usersState, load);
    };

    $("#user-search").addEventListener(
        "input",
        debounce((e) => {
            usersState.q = e.target.value.trim();
            usersState.offset = 0;
            load();
        }),
    );
    $("#user-filter").addEventListener("change", (e) => {
        usersState.filter = e.target.value;
        usersState.offset = 0;
        load();
    });
    await load();
}

function userBadges(u) {
    const badges = [];
    if (hasRight(u.rights, 0)) badges.push(html`<span class="badge accent">Operator</span>`);
    else if (hasRight(u.rights, 7) || hasRight(u.rights, 2)) badges.push(html`<span class="badge accent">Staff</span>`);
    if (u.disabled) badges.push(html`<span class="badge danger">Disabled</span>`);
    if (u.deleted) badges.push(html`<span class="badge danger">Deleted</span>`);
    if (u.bot) badges.push(html`<span class="badge info">Bot</span>`);
    if (u.tag && u.tag !== "none") badges.push(nameTag(u.tag, u.bot));
    if (u.premium_type) badges.push(html`<span class="badge">${PREMIUM_TYPES.find(([k]) => k === u.premium_type)?.[1] ?? "Premium"}</span>`);
    if (!u.verified && !u.bot) badges.push(html`<span class="badge warn">Unverified</span>`);
    return html`<div class="badges">${badges}</div>`;
}

function pager(total, st) {
    if (total <= st.limit) return html`<div class="pager"><span class="muted">${fmtNumber(total)} total</span></div>`;
    const from = st.offset + 1;
    const to = Math.min(st.offset + st.limit, total);
    return html`<div class="pager">
        <span class="muted">${fmtNumber(from)}–${fmtNumber(to)} of ${fmtNumber(total)}</span>
        <div class="row">
            <button class="btn small" data-page="prev" ${st.offset === 0 ? raw("disabled") : ""}>Previous</button>
            <button class="btn small" data-page="next" ${to >= total ? raw("disabled") : ""}>Next</button>
        </div>
    </div>`;
}

function bindPager(root, total, st, load) {
    $(`[data-page="prev"]`, root)?.addEventListener("click", () => {
        st.offset = Math.max(0, st.offset - st.limit);
        load();
    });
    $(`[data-page="next"]`, root)?.addEventListener("click", () => {
        if (st.offset + st.limit < total) st.offset += st.limit;
        load();
    });
}

async function openUser(id, reload) {
    const body = openDrawer("User", html`<div class="spinner">Loading…</div>`);
    let u, badges, standing;
    try {
        [u, badges, standing] = await Promise.all([api(`/admin/users/${id}`), api("/admin/badges"), api(`/admin/users/${id}/violations`)]);
    } catch (e) {
        return mount(body, html`<p class="form-error">${e.message}</p>`);
    }
    const isOperator = state.overview.access.operator;
    const isSelf = u.id === state.me.id;

    mount(
        body,
        html`
            <div class="ident">
                ${avatar(u, "large")}
                <div>
                    <h2>${userName(u)}</h2>
                    <span class="muted">${userTag(u)}</span>
                    <code class="muted">${u.id}</code>
                </div>
            </div>
            ${userBadges(u)}
            <div class="card">
                <div class="list">
                    <div class="list-item"><span class="grow muted">Email</span><span>${u.email || "—"}</span></div>
                    <div class="list-item"><span class="grow muted">Registered</span><span>${fmtDate(u.created_at)}</span></div>
                    <div class="list-item"><span class="grow muted">Active sessions</span><span>${fmtNumber(u.session_count)}</span></div>
                </div>
            </div>

            <form id="user-form" class="card stack">
                <h3>Profile & account</h3>
                <label>Display name<input name="global_name" value="${u.global_name ?? ""}" maxlength="32" placeholder="${u.username}" /></label>
                <label>Bio<textarea name="bio" maxlength="1024">${u.bio ?? ""}</textarea></label>
                <label>Premium<select name="premium_type">${options(PREMIUM_TYPES, u.premium_type ?? 0)}</select></label>
                <div class="stack">
                    <h3>Name tag</h3>
                    <div class="row">
                        <select name="tag" class="grow" style="max-width:260px">${options(USER_TAGS, u.tag ?? "none")}</select>
                        <span class="row" style="gap:6px"><span class="muted">Preview</span><strong>${userName(u)}</strong><span id="tag-preview"></span></span>
                    </div>
                    <span class="hint muted" id="tag-hint"></span>
                </div>
                <div class="stack">
                    <div class="row" style="justify-content:space-between"><h3>Profile badges</h3>${isOperator ? html`<a class="btn small ghost" href="#/badges">Manage badges</a>` : ""}</div>
                    ${badges.length
                        ? html`<div class="checks">${badges.map(
                              (b) => html`<label class="toggle"><input type="checkbox" name="badge" value="${b.id}" ${u.badge_ids?.includes(b.id) ? raw("checked") : ""} /><span class="row" style="gap:8px">${badgeIcon(b)}${b.description}</span></label>`,
                          )}</div>`
                        : html`<p class="muted" style="margin:0">No badges yet.${isOperator ? html` <a href="#/badges">Create one</a>.` : ""}</p>`}
                    <label class="toggle"
                        ><input type="checkbox" name="hide_premium_badge" ${u.hide_premium_badge ? raw("checked") : ""} /><span
                            ><span class="row" style="gap:8px"><img class="badge-icon" src="/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png" alt="" />Hide the Nitro badge</span
                            ><span class="hint">Their Nitro and its perks stay; the badge just isn't shown on their profile.</span></span
                        ></label
                    >
                </div>
                <label class="toggle"><input type="checkbox" name="verified" ${u.verified ? raw("checked") : ""} /><span>Email verified</span></label>
                <label class="toggle"
                    ><input type="checkbox" name="disabled" ${u.disabled ? raw("checked") : ""} ${isSelf ? raw("disabled") : ""} /><span
                        >Account disabled<span class="hint">Blocks sign-in and API access and ends their sessions. Reversible.</span></span
                    ></label
                >
                ${isOperator
                    ? html`
                          <div class="stack">
                              <h3>Instance rights</h3>
                              <div class="checks">
                                  ${RIGHTS.map(
                                      ([name, bit, hint]) =>
                                          html`<label class="toggle"
                                              ><input type="checkbox" data-right="${bit}" ${hasRight(u.rights, bit) ? raw("checked") : ""} ${isSelf && bit === 0 ? raw("disabled") : ""} /><span
                                                  ><code>${name}</code><span class="hint">${hint}</span></span
                                              ></label
                                          >`,
                                  )}
                              </div>
                          </div>
                      `
                    : ""}
                <div class="form-actions"><button class="btn primary" type="submit">Save user</button></div>
            </form>

            <div class="card stack" id="standing-card"></div>

            ${u.guilds.length
                ? html`<div class="card">
                      <h3>Servers (${u.guilds.length})</h3>
                      <div class="list">
                          ${u.guilds.map(
                              (g) => html`<div class="list-item">
                                  ${guildIcon(g)}<span class="grow">${g.name}</span>${g.owner ? html`<span class="badge accent">Owner</span>` : ""}
                                  ${state.overview.access.guilds ? html`<button class="btn small ghost" data-guild="${g.id}" type="button">Open</button>` : ""}
                              </div>`,
                          )}
                      </div>
                  </div>`
                : ""}
            ${u.instance_bans.length
                ? html`<div class="card"><h3>Instance bans</h3><div class="list">${u.instance_bans.map((b) => html`<div class="list-item"><span class="grow">${b.reason}</span><span class="muted">${fmtDay(b.created_at)}</span></div>`)}</div></div>`
                : ""}
            ${!isSelf
                ? html`<div class="card danger-zone stack">
                      <h3>Danger zone</h3>
                      <p class="muted" style="margin:0">
                          Permanently deletes the account, its DMs and memberships, hands owned servers to the next-highest member, and bans them from registering again.
                          This can't be undone.
                      </p>
                      <label>Reason<input id="ban-reason" placeholder="Shown in the instance ban list" /></label>
                      <div><button class="btn danger" id="ban-user" type="button">Delete & ban user</button></div>
                  </div>`
                : ""}
        `,
    );

    $("#user-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const patch = {
            global_name: form.global_name.value,
            bio: form.bio.value,
            premium_type: Number(form.premium_type.value),
            verified: form.verified.checked,
            tag: form.tag.value,
            hide_premium_badge: form.hide_premium_badge.checked,
        };
        // keep the order badges were originally given in, appending new ones
        const checked = $$("input[name=badge]:checked", form).map((x) => x.value);
        const nextBadges = [...(u.badge_ids ?? []).filter((b) => checked.includes(b)), ...checked.filter((b) => !(u.badge_ids ?? []).includes(b))];
        if (JSON.stringify(nextBadges) !== JSON.stringify(u.badge_ids ?? [])) patch.badge_ids = nextBadges;
        if (!isSelf) patch.disabled = form.disabled.checked;
        if (isOperator) {
            let rights = BigInt(u.rights || 0);
            for (const box of $$("[data-right]", form)) {
                const bit = 1n << BigInt(box.dataset.right);
                rights = box.checked ? rights | bit : rights & ~bit;
            }
            if (rights.toString() !== String(u.rights)) patch.rights = rights.toString();
        }
        const saved = await act($("button[type=submit]", form), () => api(`/admin/users/${u.id}`, { method: "PATCH", body: patch }), "User updated");
        if (saved) {
            reload?.();
            openUser(u.id, reload);
        }
    });

    const syncTag = () => {
        const tag = $("#user-form").tag.value;
        mount($("#tag-preview"), nameTag(tag, u.bot));
        $("#tag-hint").textContent =
            tag === "verified_bot" && !u.bot
                ? "Verified Bot only shows on bot accounts. This is a regular user, so their name will show no tag."
                : (USER_TAGS.find(([k]) => k === tag)?.[2] ?? "");
    };
    $("#user-form").tag.addEventListener("change", syncTag);
    syncTag();

    for (const btn of $$("[data-guild]", body)) btn.addEventListener("click", () => openGuild(btn.dataset.guild));

    const renderStanding = () => {
        const [, label, tone] = standingOf(standing.standing.state);
        const card = $("#standing-card");
        mount(
            card,
            html`
                <div class="row" style="justify-content:space-between">
                    <h3>Account standing</h3>
                    <span class="badge ${tone}" style="font-size:12px;padding:3px 10px"><span class="dot"></span>${label}</span>
                </div>
                <label
                    >Standing<span class="hint"
                        >What the user sees on their Account Standing page. Automatic goes down one step per active violation (suspended for disabled
                        accounts).</span
                    ><select name="standing">
                        <option value="">Automatic (${standingOf(standing.standing.automatic)[1].toLowerCase()})</option>
                        ${options(STANDINGS, standing.standing.override ?? "")}
                    </select></label
                >
                <div class="stack">
                    <h3>Violations (${standing.violations.length})</h3>
                    ${standing.violations.length
                        ? standing.violations.map(
                              (v) => html`<div class="violation ${v.active ? "" : "inactive"}" data-violation="${v.id}">
                                  <div class="row">
                                      <strong class="grow">${violationType(v.classification_type)}</strong>
                                      ${v.appeal_status === 1 ? html`<span class="badge warn">Appeal pending</span>` : ""}
                                      ${v.appeal_status === 2 ? html`<span class="badge">Appeal denied</span>` : ""}
                                      ${v.appeal_status === 3 ? html`<span class="badge ok">Overturned</span>` : ""}
                                      ${v.active ? html`<span class="badge danger">Active</span>` : v.appeal_status !== 3 ? html`<span class="badge">Expired</span>` : ""}
                                  </div>
                                  <p>${v.description}</p>
                                  ${v.appeal_status
                                      ? html`<div class="appeal-note">
                                            <strong>Appeal</strong> · ${APPEAL_REASONS[v.appeal_signal ?? 3]}${v.appealed_at ? html` · ${fmtDate(v.appealed_at)}` : ""}
                                            ${v.appeal_user_input ? html`<p>${v.appeal_user_input}</p>` : ""}
                                        </div>`
                                      : ""}
                                  ${v.actions.length ? html`<div class="badges">${v.actions.map((a) => html`<span class="badge">${violationAction(a.action_type)}</span>`)}</div>` : ""}
                                  <div class="muted">
                                      Issued ${fmtDate(v.created_at)}${v.issued_by ? html` by ${userName(v.issued_by)}` : ""} ·
                                      ${v.permanent ? "Permanent" : html`${v.active || new Date(v.expires_at) > new Date() ? "Expires" : "Expired"} ${fmtDate(v.expires_at)}`}
                                  </div>
                                  <div class="row" style="justify-content:flex-end">
                                      ${v.appeal_status === 1
                                          ? html`<button class="btn small" type="button" data-appeal="2">Deny appeal</button
                                                ><button class="btn small primary" type="button" data-appeal="3">Overturn</button>`
                                          : ""}
                                      <button class="btn small ghost" type="button" data-remove-violation>Remove</button>
                                  </div>
                              </div>`,
                          )
                        : html`<p class="muted" style="margin:0">No violations.</p>`}
                </div>
                <details class="stack">
                    <summary class="btn small" style="width:max-content">Add violation</summary>
                    <form id="violation-form" class="stack" style="margin-top:12px">
                        <label>Type<select name="classification_type">${options(VIOLATION_TYPES, 3030)}</select></label>
                        <label
                            >Message to the user<span class="hint">Shown on their Account Standing page.</span
                            ><textarea name="description" required maxlength="2000" placeholder="You sent unsolicited advertisements to other members."></textarea
                        ></label>
                        <div class="stack">
                            <span class="muted">Actions taken</span>
                            <div class="checks">
                                ${VIOLATION_ACTIONS.map(
                                    ([id, label]) => html`<label class="toggle"><input type="checkbox" name="action" value="${id}" ${id === 4 ? raw("checked") : ""} /><span>${label}</span></label>`,
                                )}
                            </div>
                        </div>
                        <label>Counts against them for<select name="duration">${options(VIOLATION_DURATIONS, 90)}</select></label>
                        <p class="muted" style="margin:0">
                            This records the violation and its effect on their standing. To actually restrict the account, disable it above.
                        </p>
                        <div class="form-actions"><button class="btn danger" type="submit">Add violation</button></div>
                    </form>
                </details>
            `,
        );

        card.querySelector("[name=standing]").addEventListener("change", async (e) => {
            const value = e.target.value === "" ? null : Number(e.target.value);
            const saved = await act(e.target, () => api(`/admin/users/${u.id}`, { method: "PATCH", body: { account_standing: value } }), "Standing updated");
            if (saved) {
                standing = await api(`/admin/users/${u.id}/violations`);
                renderStanding();
            }
        });

        for (const row of $$("[data-violation]", card)) {
            const vid = row.dataset.violation;
            for (const btn of $$("[data-appeal]", row))
                btn.addEventListener("click", async () => {
                    const next = await act(
                        btn,
                        () => api(`/admin/users/${u.id}/violations/${vid}`, { method: "PATCH", body: { appeal_status: Number(btn.dataset.appeal) } }),
                        btn.dataset.appeal === "3" ? "Violation overturned" : "Appeal denied",
                    );
                    if (next) {
                        standing = next;
                        renderStanding();
                    }
                });
            $("[data-remove-violation]", row).addEventListener("click", async (e) => {
                if (!confirm("Remove this violation completely? Use Overturn instead to keep a record of it.")) return;
                const next = await act(e.currentTarget, () => api(`/admin/users/${u.id}/violations/${vid}`, { method: "DELETE" }), "Violation removed");
                if (next) {
                    standing = next;
                    renderStanding();
                }
            });
        }

        $("#violation-form", card).addEventListener("submit", async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const payload = {
                classification_type: Number(form.classification_type.value),
                description: form.description.value,
                actions: $$("input[name=action]:checked", form).map((x) => ({ action_type: Number(x.value) })),
                expires_in_days: form.duration.value ? Number(form.duration.value) : null,
            };
            const next = await act($("button[type=submit]", form), () => api(`/admin/users/${u.id}/violations`, { method: "POST", body: payload }), "Violation added");
            if (next) {
                standing = next;
                renderStanding();
            }
        });
    };
    renderStanding();

    $("#ban-user")?.addEventListener("click", async (e) => {
        if (!confirm(`Permanently delete and ban ${userName(u)}? This can't be undone.`)) return;
        const reason = $("#ban-reason").value.trim() || `Banned from the admin dashboard by ${state.me.username}`;
        const done = await act(e.currentTarget, () => api(`/users/${u.id}/delete`, { method: "POST", body: { reason, persistInstanceBan: true } }), `${userName(u)} was deleted and banned`);
        if (done !== undefined) {
            closeDrawer();
            reload?.();
        }
    });
}

/* ---------- announcements ---------- */

async function renderAnnouncements(view) {
    const { official, announcements } = await api("/admin/announcements");
    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>Announcements</h1>
                    <p class="muted">
                        Sent as a direct message from <strong>${official.global_name || official.username}</strong>, the instance's official system account.
                        Users can't reply to it.
                    </p>
                </div>
            </div>
            <div class="stack">
                <form id="announce-form" class="card stack">
                    <h2>New announcement</h2>
                    <label>Title<input name="title" required maxlength="256" placeholder="Scheduled maintenance tonight" /></label>
                    <label
                        >Message<span class="hint">Markdown works: **bold**, *italics*, links, lists.</span
                        ><textarea name="body" required maxlength="4000" rows="6" placeholder="We'll be upgrading the database at 23:00 UTC…"></textarea
                    ></label>
                    <label
                        >Send to<select name="audience" style="max-width:320px">
                            ${options(
                                [
                                    ["everyone", "Everyone on the instance"],
                                    ["staff", "Staff only (admin panel access)"],
                                ],
                                "everyone",
                            )}
                        </select></label
                    >
                    <div class="form-actions"><button class="btn primary" type="submit">Send announcement</button></div>
                </form>
                <div class="stack">
                    <h2>Sent</h2>
                    ${announcements.length
                        ? announcements.map(
                              (a) => html`<div class="card stack" style="gap:6px">
                                  <div class="row">
                                      <strong class="grow">${a.title}</strong>
                                      <span class="badge">${a.audience === "staff" ? "Staff" : "Everyone"} · ${fmtNumber(a.recipient_count)}</span>
                                  </div>
                                  <p style="margin:0;white-space:pre-wrap">${a.body}</p>
                                  <span class="muted">${fmtDate(a.created_at)}</span>
                              </div>`,
                          )
                        : html`<div class="card empty">Nothing sent yet.</div>`}
                </div>
            </div>
        `,
    );

    $("#announce-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const audience = form.audience.value;
        if (audience === "everyone" && !confirm("Send this announcement to every user on the instance?")) return;
        const sent = await act(
            $("button[type=submit]", form),
            () => api("/admin/announcements", { method: "POST", body: { title: form.title.value, body: form.body.value, audience } }),
        );
        if (sent) {
            toast(`Sending to ${fmtNumber(sent.recipient_count)} ${sent.recipient_count === 1 ? "user" : "users"}`);
            renderAnnouncements(view);
        }
    });
}

/* ---------- badges ---------- */

// discord's own badge art; the CDN proxies any icon hash it doesn't store from discord's CDN
const BADGE_PRESETS = [
    ["5e74e9b61934fc1f67c65515d1f7e60d", "Staff"],
    ["3f9748e53446a137a052f3454e2de41e", "Partnered Server Owner"],
    ["fee1624003e2fee35cb398e125dc479b", "Moderator Programs Alumni"],
    ["bf01d1073931f921909045f3a39fd264", "HypeSquad Events"],
    ["8a88d63823d8a71cd5e390baa45efa02", "HypeSquad Bravery"],
    ["011940fd013da3f7fb926e4a1cd2e618", "HypeSquad Brilliance"],
    ["3aa41de486fa12454c3761e8e223442e", "HypeSquad Balance"],
    ["2717692c7dca7289b35297368a940dd0", "Bug Hunter"],
    ["848f79194d4be5ff5f81505cbd0ce1e6", "Gold Bug Hunter"],
    ["6df5892e0f35b051f8b61eace34f4967", "Early Verified Bot Developer"],
    ["6bdc42827a38498929a4920da12695d9", "Active Developer"],
    ["7060786766c9c840eb3019e725d2b358", "Early Supporter"],
    ["2ba85e8026a8614b640c2837bcdfe21b", "Subscriber"],
    ["7d9ae358c8c5e118768335dbe68b4fb8", "Completed a Quest"],
    ["83d8a1eb09a8d64e59233eec5d4d5c2d", "Orbs Apprentice"],
];

const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

async function renderBadges(view) {
    const badges = await api("/admin/badges");
    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>Badges</h1>
                    <p class="muted">Badges shown on user profiles. Create them here, then give them to people from their user page.</p>
                </div>
                <button class="btn primary" id="new-badge" type="button">Create badge</button>
            </div>
            ${badges.length
                ? html`<div class="table-wrap">
                      <table>
                          <thead>
                              <tr>
                                  <th>Badge</th>
                                  <th class="hide-sm">Link</th>
                                  <th>Given to</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${badges.map(
                                  (b) => html`<tr data-id="${b.id}">
                                      <td><div class="ident">${badgeIcon(b)}<strong>${b.description}</strong></div></td>
                                      <td class="hide-sm">${b.link ? html`<span class="muted">${b.link}</span>` : html`<span class="muted">—</span>`}</td>
                                      <td>${fmtNumber(b.holders)} ${b.holders === 1 ? "user" : "users"}</td>
                                  </tr>`,
                              )}
                          </tbody>
                      </table>
                  </div>`
                : html`<div class="card empty">No badges yet. Create one, or start from one of Discord's.</div>`}
        `,
    );
    const refresh = () => renderBadges(view);
    $("#new-badge").addEventListener("click", () => openBadge(null, refresh));
    for (const row of $$("tbody tr", view)) row.addEventListener("click", () => openBadge(badges.find((b) => b.id === row.dataset.id), refresh));
}

function openBadge(badge, refresh) {
    let icon = badge?.icon ?? null;
    let iconData = null;
    const body = openDrawer(
        badge ? "Edit badge" : "Create badge",
        html`
            <form id="badge-form" class="stack">
                <div class="card row" style="gap:12px">
                    <span id="badge-preview" class="badge-preview"></span>
                    <div class="grow">
                        <strong id="badge-preview-text">${badge?.description ?? "Badge name"}</strong>
                        <div class="muted">Shown as a tooltip when hovering the badge on a profile.</div>
                    </div>
                </div>
                <label>Tooltip text<input name="description" required maxlength="120" value="${badge?.description ?? ""}" placeholder="Early Tester" /></label>
                <label>Link<span class="hint">Optional. Opens when the badge is clicked.</span><input name="link" type="url" value="${badge?.link ?? ""}" placeholder="https://…" /></label>
                <div class="stack">
                    <h3>Icon</h3>
                    <label>Upload an image<span class="hint">Square PNG, WebP or GIF. Shown at about 22px.</span><input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
                    <span class="muted">or use one of Discord's</span>
                    <div class="preset-grid">
                        ${BADGE_PRESETS.map(
                            ([hash, name]) =>
                                html`<button type="button" class="preset ${hash === icon ? "active" : ""}" data-preset="${hash}" data-name="${name}" title="${name}"><img src="/badge-icons/${hash}.png" alt="${name}" /></button>`,
                        )}
                    </div>
                </div>
                <div class="form-actions">
                    ${badge ? html`<button class="btn danger" id="badge-delete" type="button" style="margin-right:auto">Delete badge</button>` : ""}
                    <button class="btn primary" type="submit">${badge ? "Save badge" : "Create badge"}</button>
                </div>
            </form>
        `,
    );
    const form = $("#badge-form", body);
    const preview = () => {
        const src = iconData ?? (icon ? `/badge-icons/${icon}.png` : null);
        mount($("#badge-preview"), src ? html`<img class="badge-icon large" src="${src}" alt="" />` : html`<span class="muted">?</span>`);
        $("#badge-preview-text").textContent = form.description.value || "Badge name";
        for (const b of $$("[data-preset]", form)) b.classList.toggle("active", !iconData && b.dataset.preset === icon);
    };
    preview();

    form.description.addEventListener("input", preview);
    form.file.addEventListener("change", async () => {
        const file = form.file.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            form.file.value = "";
            return toast("Badge icons have to be under 2 MB.", "error");
        }
        iconData = await readAsDataUrl(file);
        preview();
    });
    for (const btn of $$("[data-preset]", form))
        btn.addEventListener("click", () => {
            icon = btn.dataset.preset;
            iconData = null;
            form.file.value = "";
            if (!form.description.value) form.description.value = btn.dataset.name;
            preview();
        });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!icon && !iconData) return toast("Pick a preset or upload an icon first.", "error");
        const payload = { description: form.description.value, link: form.link.value || null };
        if (iconData) payload.icon_data = iconData;
        else if (icon !== badge?.icon) payload.icon = icon;
        const done = await act(
            $("button[type=submit]", form),
            () => (badge ? api(`/admin/badges/${badge.id}`, { method: "PATCH", body: payload }) : api("/admin/badges", { method: "POST", body: payload })),
            badge ? "Badge saved" : "Badge created",
        );
        if (done) {
            closeDrawer();
            refresh();
        }
    });

    $("#badge-delete", body)?.addEventListener("click", async (e) => {
        const who = badge.holders ? ` It's taken off the ${badge.holders} ${badge.holders === 1 ? "user" : "users"} who have it.` : "";
        if (!confirm(`Delete the "${badge.description}" badge?${who}`)) return;
        const done = await act(e.currentTarget, () => api(`/admin/badges/${badge.id}`, { method: "DELETE" }), "Badge deleted");
        if (done !== undefined) {
            closeDrawer();
            refresh();
        }
    });
}

/* ---------- guilds ---------- */

const guildsState = { q: "", offset: 0, limit: 50 };

async function renderGuilds(view) {
    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>Servers</h1>
                    <p class="muted">Every server on this instance. Click one to edit, transfer or delete it.</p>
                </div>
            </div>
            <div class="row" style="margin-bottom:12px">
                <input class="grow" id="guild-search" type="search" placeholder="Search servers by name or ID…" value="${guildsState.q}" style="max-width:420px" />
            </div>
            <div id="guild-results"><div class="spinner">Loading…</div></div>
        `,
    );

    const load = async () => {
        const params = new URLSearchParams({ q: guildsState.q, limit: guildsState.limit, offset: guildsState.offset });
        const { guilds, total } = await api(`/admin/guilds?${params}`);
        const results = $("#guild-results");
        if (!results) return;
        mount(
            results,
            guilds.length
                ? html`
                      <div class="table-wrap">
                          <table>
                              <thead>
                                  <tr>
                                      <th>Server</th>
                                      <th>Owner</th>
                                      <th>Members</th>
                                      <th class="hide-sm">Created</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${guilds.map(
                                      (g) => html`
                                          <tr data-id="${g.id}">
                                              <td>
                                                  <div class="ident">
                                                      ${guildIcon(g)}
                                                      <div>
                                                          <strong class="row" style="gap:6px">${g.name}${g.tag ? tagChip(g.id, g.tag.tag, g.tag.badge_hash) : ""}</strong>
                                                          ${g.features.length ? html`<span class="muted">${g.features.slice(0, 3).join(", ")}${g.features.length > 3 ? "…" : ""}</span>` : ""}
                                                      </div>
                                                  </div>
                                              </td>
                                              <td>${g.owner ? html`<div class="ident">${avatar(g.owner)}<span>${userName(g.owner)}</span></div>` : html`<span class="muted">None</span>`}</td>
                                              <td>${fmtNumber(g.member_count)}</td>
                                              <td class="hide-sm">${fmtDay(snowflakeDate(g.id))}</td>
                                          </tr>
                                      `,
                                  )}
                              </tbody>
                          </table>
                      </div>
                      ${pager(total, guildsState)}
                  `
                : html`<div class="card empty">No servers match.</div>`,
        );
        for (const row of $$("tbody tr", results)) row.addEventListener("click", () => openGuild(row.dataset.id, load));
        bindPager(results, total, guildsState, load);
    };

    $("#guild-search").addEventListener(
        "input",
        debounce((e) => {
            guildsState.q = e.target.value.trim();
            guildsState.offset = 0;
            load();
        }),
    );
    await load();
}

async function openGuild(id, reload) {
    const body = openDrawer("Server", html`<div class="spinner">Loading…</div>`);
    let g;
    try {
        g = await api(`/admin/guilds/${id}`);
    } catch (e) {
        return mount(body, html`<p class="form-error">${e.message}</p>`);
    }
    const features = new Set(g.features);

    const renderFeatures = () =>
        mount(
            $("#feature-chips"),
            features.size
                ? [...features].map((f) => html`<span class="chip">${f}<button type="button" data-remove="${f}" aria-label="Remove ${f}">✕</button></span>`)
                : html`<span class="muted">No features</span>`,
        );

    mount(
        body,
        html`
            <div class="ident">
                ${guildIcon(g, "large")}
                <div>
                    <h2>${g.name}</h2>
                    <code class="muted">${g.id}</code>
                </div>
            </div>
            <div class="card">
                <div class="list">
                    <div class="list-item">
                        <span class="grow muted">Owner</span>
                        ${g.owner ? html`<span class="ident">${avatar(g.owner)}<span>${userName(g.owner)}</span></span>` : "None"}
                        ${g.owner && state.overview.access.users ? html`<button class="btn small ghost" id="open-owner" type="button">Open</button>` : ""}
                    </div>
                    <div class="list-item"><span class="grow muted">Members</span><span>${fmtNumber(g.member_count)}</span></div>
                    <div class="list-item"><span class="grow muted">Channels</span><span>${fmtNumber(g.channel_count)}</span></div>
                    <div class="list-item"><span class="grow muted">Created</span><span>${fmtDate(snowflakeDate(g.id))}</span></div>
                </div>
            </div>

            <form id="guild-form" class="card stack">
                <h3>Details</h3>
                <label>Name<input name="name" value="${g.name}" minlength="2" maxlength="100" required /></label>
                <label>Description<textarea name="description" maxlength="300">${g.description ?? ""}</textarea></label>
                <div class="stack">
                    <div class="row" style="justify-content:space-between"><h3>Server tag</h3><span id="tag-preview"></span></div>
                    <label
                        >Tag<span class="hint"
                            >Shown next to members' names. Staff can use any text of any length here (server owners are limited to 2–4 letters or numbers).
                            Leave empty to remove the tag.</span
                        ><input name="tag" autocomplete="off" value="${g.tag?.tag ?? ""}" placeholder="LARP"
                    /></label>
                    <div class="stack" id="tag-badge-fields">
                        <span class="muted">Badge</span>
                        <div id="badge-picker" class="badge-picker"><span class="muted">Loading badges…</span></div>
                        <label class="toggle"
                            ><input type="checkbox" name="badge_default_colors" ${g.tag?.badge_color_primary ? "" : raw("checked")} /><span
                                >Use the badge's own colours</span
                            ></label
                        >
                        <div class="row" id="badge-colors">
                            <label class="row" style="gap:8px">Main<input type="color" name="badge_color_primary" value="${g.tag?.badge_color_primary ?? "#5865f2"}" /></label>
                            <label class="row" style="gap:8px">Accent<input type="color" name="badge_color_secondary" value="${g.tag?.badge_color_secondary ?? "#ffffff"}" /></label>
                        </div>
                    </div>
                </div>
                <div class="stack">
                    <h3>Feature flags</h3>
                    <div id="feature-chips" class="chips"></div>
                    <div class="row">
                        <input class="grow" id="feature-input" list="feature-list" placeholder="Add a feature, e.g. VERIFIED" />
                        <datalist id="feature-list">${GUILD_FEATURES.map((f) => html`<option value="${f}"></option>`)}</datalist>
                        <button class="btn" type="button" id="feature-add">Add</button>
                    </div>
                </div>
                <label>Owner user ID<span class="hint">Transfer ownership to another member of this server.</span><input name="owner_id" value="${g.owner?.id ?? ""}" inputmode="numeric" /></label>
                <div class="form-actions"><button class="btn primary" type="submit">Save server</button></div>
            </form>

            <div class="card danger-zone stack">
                <h3>Danger zone</h3>
                <p class="muted" style="margin:0">Deletes the server with all its channels, messages, roles and members. This can't be undone.</p>
                <label>Type the server name to confirm<input id="guild-confirm" placeholder="${g.name}" autocomplete="off" /></label>
                <div><button class="btn danger" id="guild-delete" type="button" disabled>Delete server</button></div>
            </div>
        `,
    );
    renderFeatures();

    const addFeature = () => {
        const input = $("#feature-input");
        const value = input.value.trim().toUpperCase().replace(/\s+/g, "_");
        if (value) features.add(value);
        input.value = "";
        renderFeatures();
    };
    $("#feature-add").addEventListener("click", addFeature);
    $("#feature-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addFeature();
        }
    });
    $("#feature-chips").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove]");
        if (!btn) return;
        features.delete(btn.dataset.remove);
        renderFeatures();
    });
    $("#open-owner")?.addEventListener("click", () => openUser(g.owner.id));

    const tagForm = $("#guild-form");
    let badge = g.tag?.badge ?? 0;
    const badgeColours = () =>
        tagForm.badge_default_colors.checked ? {} : { primary: tagForm.badge_color_primary.value, secondary: tagForm.badge_color_secondary.value };
    const previewUrl = (id, size) => `/clan-badges/preview/${id}?${new URLSearchParams({ size, ...badgeColours() })}`;
    const renderTagPreview = () => {
        const tag = tagForm.tag.value.trim();
        $("#tag-badge-fields").hidden = !tag;
        $("#badge-colors").hidden = tagForm.badge_default_colors.checked;
        mount($("#tag-preview"), tag ? html`<span class="tag-chip"><img src="${previewUrl(badge, 32)}" alt="" />${tag}</span>` : html`<span class="muted">No tag</span>`);
        for (const img of $$("[data-badge] img", tagForm)) img.src = previewUrl(img.closest("[data-badge]").dataset.badge, 48);
        for (const btn of $$("[data-badge]", tagForm)) btn.classList.toggle("active", Number(btn.dataset.badge) === badge);
    };
    fetch("/clan-badges/preview")
        .then((r) => r.json())
        .then((list) => {
            mount(
                $("#badge-picker"),
                list.length
                    ? list.map(
                          (b) =>
                              html`<button type="button" class="badge-option" data-badge="${b.id}" title="${b.name.toLowerCase().replace(/_/g, " ")}"
                                  ><img src="${previewUrl(b.id, 48)}" alt="${b.name}"
                              /></button>`,
                      )
                    : html`<span class="muted">Badge artwork isn't available. Run <code>npm run generate:client</code> on the server.</span>`,
            );
            renderTagPreview();
        })
        .catch(() => mount($("#badge-picker"), html`<span class="muted">Couldn't load badges.</span>`));
    $("#badge-picker").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-badge]");
        if (!btn) return;
        badge = Number(btn.dataset.badge);
        renderTagPreview();
    });
    tagForm.tag.addEventListener("input", renderTagPreview);
    tagForm.badge_default_colors.addEventListener("change", renderTagPreview);
    for (const input of [tagForm.badge_color_primary, tagForm.badge_color_secondary]) input.addEventListener("input", debounce(renderTagPreview, 150));
    renderTagPreview();

    $("#guild-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const patch = { name: form.name.value, description: form.description.value, features: [...features] };
        const owner = form.owner_id.value.trim();
        if (owner && owner !== g.owner?.id) patch.owner_id = owner;

        const tag = form.tag.value.trim();
        const colours = badgeColours();
        const next = { tag: tag || null, badge, badge_color_primary: colours.primary ?? null, badge_color_secondary: colours.secondary ?? null };
        const prev = g.tag ? { tag: g.tag.tag, badge: g.tag.badge, badge_color_primary: g.tag.badge_color_primary, badge_color_secondary: g.tag.badge_color_secondary } : { tag: null };
        if (!next.tag) {
            if (prev.tag) patch.tag = null;
        } else if (JSON.stringify(next) !== JSON.stringify(prev)) Object.assign(patch, next);
        const saved = await act($("button[type=submit]", form), () => api(`/admin/guilds/${g.id}`, { method: "PATCH", body: patch }), "Server updated");
        if (saved) {
            reload?.();
            openGuild(g.id, reload);
        }
    });

    $("#guild-confirm").addEventListener("input", (e) => {
        $("#guild-delete").disabled = e.target.value !== g.name;
    });
    $("#guild-delete").addEventListener("click", async (e) => {
        const done = await act(e.currentTarget, () => api(`/admin/guilds/${g.id}`, { method: "DELETE" }), `${g.name} was deleted`);
        if (done !== undefined) {
            closeDrawer();
            reload?.();
        }
    });
}

/* ---------- status page ---------- */

async function renderStatus(view) {
    const [summary, components, { incidents }] = await Promise.all([
        api("/status/summary.json", { auth: false }),
        api("/admin/status/components"),
        api("/admin/status/incidents?limit=50"),
    ]);
    const open = incidents.filter((i) => !RESOLVED.includes(i.status));
    const closed = incidents.filter((i) => RESOLVED.includes(i.status));
    const indicatorClass = { none: "ok", maintenance: "info", minor: "warn", major: "warn", critical: "danger" }[summary.status.indicator] ?? "";

    mount(
        view,
        html`
            <div class="page-head">
                <div>
                    <h1>Status page</h1>
                    <p class="muted">Components, incidents and maintenance shown on the public <a href="/status" target="_blank" rel="noopener">status page</a>.</p>
                </div>
                <div class="row">
                    <button class="btn" id="new-maintenance" type="button">Schedule maintenance</button>
                    <button class="btn primary" id="new-incident" type="button">Report incident</button>
                </div>
            </div>
            <div class="stack">
                <div class="card row">
                    <span class="badge ${indicatorClass}" style="font-size:13px;padding:5px 12px"><span class="dot"></span>${summary.status.description}</span>
                    <span class="muted">Currently shown at the top of the public page.</span>
                </div>

                <div class="card">
                    <div class="row" style="justify-content:space-between;margin-bottom:8px">
                        <h2>Components</h2>
                    </div>
                    <div class="list" id="component-list">
                        ${components.length
                            ? components.map(
                                  (c) => html`
                                      <div class="list-item" data-component="${c.id}">
                                          <div class="grow">
                                              <strong>${c.name}</strong>
                                              ${c.description ? html`<div class="muted">${c.description}</div>` : ""}
                                          </div>
                                          <select data-status style="width:auto">${options(COMPONENT_STATUSES, c.status)}</select>
                                          <button class="btn small ghost" data-edit type="button">Edit</button>
                                          <button class="btn small ghost" data-delete type="button" aria-label="Delete ${c.name}">Delete</button>
                                      </div>
                                  `,
                              )
                            : html`<p class="muted">No components yet. Add the parts of your service people care about, like "API", "Gateway" or "Media".</p>`}
                    </div>
                    <form id="component-add" class="row" style="margin-top:12px">
                        <input name="name" placeholder="Component name, e.g. Gateway" required maxlength="100" class="grow" style="min-width:180px" />
                        <input name="description" placeholder="Description (optional)" class="grow" style="min-width:180px" />
                        <button class="btn" type="submit">Add component</button>
                    </form>
                </div>

                <div class="stack">
                    <h2>Open incidents & maintenance</h2>
                    ${open.length ? open.map((i) => incidentCard(i, true)) : html`<div class="card empty">Nothing open. All quiet.</div>`}
                </div>

                <div class="stack">
                    <h2>History</h2>
                    ${closed.length ? closed.map((i) => incidentCard(i, false)) : html`<div class="card empty">No resolved incidents yet.</div>`}
                </div>
            </div>
        `,
    );

    const refresh = () => renderStatus(view);

    $("#new-incident").addEventListener("click", () => openIncidentForm(components, false, refresh));
    $("#new-maintenance").addEventListener("click", () => openIncidentForm(components, true, refresh));

    $("#component-add").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const done = await act(
            $("button", form),
            () => api("/admin/status/components", { method: "POST", body: { name: form.name.value, description: form.description.value || null } }),
            "Component added",
        );
        if (done) refresh();
    });

    for (const row of $$("[data-component]", view)) {
        const id = row.dataset.component;
        const component = components.find((c) => c.id === id);
        $("[data-status]", row).addEventListener("change", async (e) => {
            const done = await act(e.target, () => api(`/admin/status/components/${id}`, { method: "PATCH", body: { status: e.target.value } }), `${component.name}: ${componentStatus(e.target.value)[1]}`);
            if (done) refresh();
        });
        $("[data-edit]", row).addEventListener("click", () => {
            const body = openDrawer(
                "Edit component",
                html`<form id="component-edit" class="stack">
                    <label>Name<input name="name" value="${component.name}" required maxlength="100" /></label>
                    <label>Description<textarea name="description">${component.description ?? ""}</textarea></label>
                    <label>Position<span class="hint">Lower numbers are listed first.</span><input name="position" type="number" value="${component.position}" /></label>
                    <div class="form-actions"><button class="btn primary" type="submit">Save component</button></div>
                </form>`,
            );
            $("#component-edit", body).addEventListener("submit", async (ev) => {
                ev.preventDefault();
                const f = ev.currentTarget;
                const done = await act(
                    $("button", f),
                    () => api(`/admin/status/components/${id}`, { method: "PATCH", body: { name: f.name.value, description: f.description.value || null, position: Number(f.position.value) || 0 } }),
                    "Component saved",
                );
                if (done) refresh();
            });
        });
        $("[data-delete]", row).addEventListener("click", async (e) => {
            if (!confirm(`Delete the "${component.name}" component? It's also removed from incidents that reference it.`)) return;
            const done = await act(e.currentTarget, () => api(`/admin/status/components/${id}`, { method: "DELETE" }), "Component deleted");
            if (done !== undefined) refresh();
        });
    }

    for (const card of $$("[data-incident]", view)) {
        const incident = incidents.find((i) => i.id === card.dataset.incident);
        $("[data-update-form]", card)?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const done = await act($("button[type=submit]", f), () => api(`/admin/status/incidents/${incident.id}/updates`, { method: "POST", body: { status: f.status.value, body: f.body.value } }), "Update posted");
            if (done) refresh();
        });
        $("[data-edit]", card)?.addEventListener("click", () => openIncidentForm(components, incident.impact === "maintenance", refresh, incident));
        $("[data-delete]", card).addEventListener("click", async (e) => {
            if (!confirm(`Delete "${incident.name}" and its whole timeline? Use an update to resolve it instead if it should stay in the history.`)) return;
            const done = await act(e.currentTarget, () => api(`/admin/status/incidents/${incident.id}`, { method: "DELETE" }), "Incident deleted");
            if (done !== undefined) refresh();
        });
    }
}

function incidentCard(i, isOpen) {
    const isMaintenance = i.impact === "maintenance";
    const states = isMaintenance ? MAINTENANCE_STATES : INCIDENT_STATES;
    return html`
        <div class="incident" data-incident="${i.id}">
            <div class="row">
                <strong class="grow">${i.name}</strong>
                ${impactBadge(i)} ${stateBadge(i.status)}
            </div>
            <div class="muted">
                ${isMaintenance && i.scheduled_for ? html`Window: ${fmtDate(i.scheduled_for)} → ${fmtDate(i.scheduled_until)} · ` : ""}Opened ${fmtDate(i.created_at)}${i.resolved_at
                    ? html` · ${isMaintenance ? "Completed" : "Resolved"} ${fmtDate(i.resolved_at)}`
                    : ""}
            </div>
            ${i.components.length ? html`<div class="badges">${i.components.map((c) => html`<span class="badge">${c.name}</span>`)}</div>` : ""}
            <div class="timeline">
                ${i.incident_updates.map(
                    (u) => html`<div class="timeline-item">
                        <div class="row"><strong>${stateLabel(u.status)}</strong><span class="muted">${fmtDate(u.created_at)}</span></div>
                        <p>${u.body}</p>
                    </div>`,
                )}
            </div>
            ${isOpen
                ? html`<form data-update-form class="stack">
                      <div class="row">
                          <select name="status" style="width:auto">${options(states, states[Math.min(states.findIndex(([k]) => k === i.status) + 1, states.length - 1)][0])}</select>
                          <span class="muted">Posting an update moves the ${isMaintenance ? "maintenance" : "incident"} to this state.</span>
                      </div>
                      <textarea name="body" placeholder="What's the latest?" required></textarea>
                      <div class="row" style="justify-content:flex-end">
                          <button class="btn ghost small" data-edit type="button">Edit details</button>
                          <button class="btn ghost small" data-delete type="button">Delete</button>
                          <button class="btn primary small" type="submit">Post update</button>
                      </div>
                  </form>`
                : html`<div class="row" style="justify-content:flex-end"><button class="btn ghost small" data-delete type="button">Delete</button></div>`}
        </div>
    `;
}

function openIncidentForm(components, isMaintenance, refresh, existing) {
    const editing = !!existing;
    const title = editing ? `Edit ${isMaintenance ? "maintenance" : "incident"}` : isMaintenance ? "Schedule maintenance" : "Report incident";
    const body = openDrawer(
        title,
        html`
            <form id="incident-form" class="stack">
                <label>Title<input name="name" required maxlength="200" value="${existing?.name ?? ""}" placeholder="${isMaintenance ? "Database upgrade" : "Messages failing to send"}" /></label>
                ${isMaintenance
                    ? html`<div class="form-grid">
                          <label>Starts<input name="scheduled_for" type="datetime-local" required value="${toLocalInput(existing?.scheduled_for)}" /></label>
                          <label>Ends<input name="scheduled_until" type="datetime-local" required value="${toLocalInput(existing?.scheduled_until)}" /></label>
                      </div>`
                    : html`<label>Impact<select name="impact">${options(IMPACTS, existing?.impact ?? "minor")}</select></label>`}
                ${!editing
                    ? html`<label
                              >Status<select name="status">
                                  ${options(isMaintenance ? MAINTENANCE_STATES.filter(([k]) => k !== "completed") : INCIDENT_STATES.filter(([k]) => k !== "resolved"), isMaintenance ? "scheduled" : "investigating")}
                              </select></label
                          >
                          <label>Message<span class="hint">The first entry in the public timeline.</span><textarea name="body" required placeholder="${isMaintenance ? "We'll be upgrading…" : "We're looking into reports of…"}"></textarea></label>`
                    : ""}
                <div class="stack">
                    <h3>Affected components</h3>
                    ${components.length
                        ? html`<div class="checks">
                              ${components.map(
                                  (c) => html`<label class="toggle"><input type="checkbox" name="component" value="${c.id}" ${existing?.components.some((x) => x.id === c.id) ? raw("checked") : ""} /><span>${c.name}</span></label>`,
                              )}
                          </div>`
                        : html`<p class="muted">No components yet. Add some on the status page tab.</p>`}
                    ${!editing && !isMaintenance && components.length
                        ? html`<label
                              >Set affected components to<select name="component_status">
                                  ${options(
                                      COMPONENT_STATUSES.filter(([k]) => k !== "operational" && k !== "under_maintenance"),
                                      "partial_outage",
                                  )}
                              </select></label
                          >`
                        : ""}
                    ${isMaintenance && !editing ? html`<p class="muted">Components switch to "Under maintenance" when you mark the maintenance in progress.</p>` : ""}
                </div>
                <div class="form-actions"><button class="btn primary" type="submit">${editing ? "Save changes" : isMaintenance ? "Schedule" : "Publish incident"}</button></div>
            </form>
        `,
    );

    $("#incident-form", body).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const component_ids = $$("input[name=component]:checked", f).map((x) => x.value);
        const payload = { name: f.name.value, component_ids };
        if (isMaintenance) {
            payload.scheduled_for = fromLocalInput(f.scheduled_for.value);
            payload.scheduled_until = fromLocalInput(f.scheduled_until.value);
            if (new Date(payload.scheduled_until) <= new Date(payload.scheduled_for)) return toast("The maintenance has to end after it starts.", "error");
        } else payload.impact = f.impact.value;

        let done;
        if (editing) done = await act($("button[type=submit]", f), () => api(`/admin/status/incidents/${existing.id}`, { method: "PATCH", body: payload }), "Saved");
        else {
            Object.assign(payload, { status: f.status.value, body: f.body.value, impact: isMaintenance ? "maintenance" : payload.impact });
            if (f.component_status && component_ids.length) payload.component_status = f.component_status.value;
            done = await act($("button[type=submit]", f), () => api("/admin/status/incidents", { method: "POST", body: payload }), isMaintenance ? "Maintenance scheduled" : "Incident published");
        }
        if (done) {
            closeDrawer();
            refresh();
        }
    });
}

boot();
