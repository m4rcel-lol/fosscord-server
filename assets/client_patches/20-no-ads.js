(() => {
    const blocked = /^\/(store|shop|quest-home|quests|discovery\/quests)(\/|$)/;
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
        [/^https:\/\/status\.discord\.com\/api\/v2\//, () => `${location.origin}/api/v9/`],
    ];
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const target = rewrites.reduce((acc, [pattern, to]) => (pattern.test(acc) ? acc.replace(pattern, to()) : acc), String(url));
        return open.call(this, method, target, ...rest);
    };

    const quest = 'path[d^="M7.5 21.7a8.95 8.95 0 0 1 9 0"]';
    const style = document.createElement("style");
    style.textContent = `
li:has(> div > a[href="/store"]),
li:has(> div > a[href="/shop"]),
li:has(> div > a[href="/quest-home"]),
[role="tab"]:has(${quest}),
div[class^="listItem__"]:has([data-list-item-id="guildsnav___app-download-button"]) {
    display: none !important;
}
`;
    document.head.append(style);
})();
