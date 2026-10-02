(() => {
    const blocked = /^\/(store|quest-home|quests|discovery\/quests)(\/|$)/;
    const home = "/channels/@me";

    if (blocked.test(location.pathname)) history.replaceState(history.state, "", home);

    for (const method of ["pushState", "replaceState"]) {
        const original = history[method];
        history[method] = function (state, title, url) {
            if (url == null || !blocked.test(new URL(url, location.href).pathname)) return original.call(this, state, title, url);
            original.call(this, state, title, home);
            queueMicrotask(() => window.dispatchEvent(new PopStateEvent("popstate", { state })));
        };
    }

    const rewrites = [
        [/^https:\/\/cdn\.discordapp\.com\/changelogs\//, () => `${location.protocol}//${window.GLOBAL_ENV?.CDN_HOST || location.host}/changelogs/`],
        [/^https:\/\/cdn\.discordapp\.com\/bad-domains\//, () => `${location.protocol}//${window.GLOBAL_ENV?.CDN_HOST || location.host}/bad-domains/`],
        [/^https:\/\/status\.discord\.com\/api\/v2\//, () => `${location.origin}/api/v9/`],
    ];
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const target = rewrites.reduce((acc, [pattern, to]) => (pattern.test(acc) ? acc.replace(pattern, to()) : acc), String(url));
        return open.call(this, method, target, ...rest);
    };
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
        if (typeof input !== "string" && !(input instanceof URL)) return nativeFetch.call(this, input, init);
        const target = rewrites.reduce((acc, [pattern, to]) => (pattern.test(acc) ? acc.replace(pattern, to()) : acc), String(input));
        return nativeFetch.call(this, target, init);
    };

    const quest = 'path[d^="M7.5 21.7a8.95 8.95 0 0 1 9 0"]';
    const style = document.createElement("style");
    style.textContent = `
li:has(> div > a[href="/store"]),
li:has(> div > a[href="/quest-home"]),
[role="tab"]:has(${quest}),
div[class^="listItem__"]:has([data-list-item-id="guildsnav___app-download-button"]),
li:has(> div > [data-list-item-id^="channels___skill-trees-"]),
#guild-header-popout-premium-subscribe,
li:has(> ul > li[data-settings-sidebar-item="billing_panel"]),
.container__5287f,
.emptyState__70126,
.container__8279f,
div:has(> i.iconApple_b68a35),
div:has(> i.iconMetaQuest_b68a35),
[role="button"]:has(> img[src="/assets/eea7561d0cfcff41.svg"]),
[role="button"]:has(> img[src*="/bc3217e772906510d881b75ebefea754b9c3ba903ddf6f994e46e5c5a85770a3."]) {
    display: none !important;
}
`;
    document.head.append(style);
})();
