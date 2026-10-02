(() => {
    const cdn = () => `${location.protocol}//${window.GLOBAL_ENV?.CDN_HOST || location.host}`;
    const rules = [
        [/^https:\/\/cdn\.discordapp\.com\/assets\/content\//, () => `${cdn()}/content-assets/`],
        [/^https:\/\/cdn\.discordapp\.com\/assets\/krisp_browser_models\//, () => `${cdn()}/krisp_browser_models/`],
        [/^https:\/\/cdn\.discordapp\.com\/(media\/v1\/collectibles-shop|badge-icons|avatar-decoration-presets|app-icons|bad-domains)\//, (match, prefix) => `${cdn()}/${prefix}/`],
    ];
    const downgraded = /^(?:http:)?\/\/((?:[\w-]+\.)*(?:discord\.com|discordapp\.com|discordapp\.net|discord\.gg|discord\.media|dis\.gd|discordstatus\.com))(?=[/:?#]|$)/i;
    const rewrite = (value) => {
        if (typeof value !== "string" || !value.includes("cdn.discordapp.com")) return value;
        return rules.reduce((acc, [pattern, to]) => acc.replace(pattern, to), value);
    };
    const link = (value) => (typeof value === "string" ? rewrite(value.replace(downgraded, "https://$1")) : value);
    const rewriteCss = (value) =>
        typeof value === "string" && value.includes("cdn.discordapp.com") ? value.replace(/url\((["']?)(https:\/\/cdn\.discordapp\.com\/[^"')]+)\1\)/g, (all, quote, url) => `url(${quote}${rewrite(url)}${quote})`) : value;

    const fetch = window.fetch;
    window.fetch = function (input, init) {
        if (typeof input === "string") return fetch.call(this, rewrite(input), init);
        if (input instanceof URL) return fetch.call(this, rewrite(input.href), init);
        if (input instanceof Request && input.url.includes("cdn.discordapp.com")) return fetch.call(this, new Request(rewrite(input.url), input), init);
        return fetch.call(this, input, init);
    };

    const openWindow = window.open;
    window.open = function (url, ...rest) {
        return openWindow.call(this, url == null ? url : link(String(url)), ...rest);
    };

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        return open.call(this, method, rewrite(String(url)), ...rest);
    };

    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (name === "href" && this instanceof HTMLAnchorElement) return setAttribute.call(this, name, link(value));
        if (name === "src" || name === "href" || name === "poster" || name === "xlink:href") return setAttribute.call(this, name, rewrite(value));
        if (name === "style") return setAttribute.call(this, name, rewriteCss(value));
        return setAttribute.call(this, name, value);
    };

    const wrap = (proto, prop, transform) => {
        const descriptor = proto && Object.getOwnPropertyDescriptor(proto, prop);
        if (!descriptor?.set) return;
        Object.defineProperty(proto, prop, {
            ...descriptor,
            set(value) {
                descriptor.set.call(this, transform(value));
            },
        });
    };
    wrap(HTMLAnchorElement.prototype, "href", link);
    wrap(HTMLImageElement.prototype, "src", rewrite);
    wrap(HTMLMediaElement.prototype, "src", rewrite);
    wrap(HTMLSourceElement.prototype, "src", rewrite);
    wrap(HTMLVideoElement.prototype, "poster", rewrite);
    for (const prop of ["background", "backgroundImage", "maskImage", "webkitMaskImage", "content"]) wrap(CSSStyleDeclaration.prototype, prop, rewriteCss);
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
        return setProperty.call(this, name, rewriteCss(value), priority);
    };
})();
