(() => {
    const find = /(\blet \w+=)"https:\/\/discord\.gg"\}/;
    const replace = '$1`${location.origin}/invite`}';

    const patchModules = (modules) => {
        if (!modules || typeof modules !== "object") return;
        for (const id of Object.keys(modules)) {
            const factory = modules[id];
            if (typeof factory !== "function" || factory.__vanityHostPatched) continue;
            const source = factory.toString();
            if (!source.includes('"https://discord.gg"}')) continue;
            const patched = source.replace(find, replace);
            if (patched === source) continue;
            try {
                const replacement = (0, eval)(`({${patched}})`)[id] ?? (0, eval)(`(${patched})`);
                replacement.__vanityHostPatched = true;
                modules[id] = replacement;
            } catch (e) {
                console.error("[vanity-invite-host] failed to patch module", id, e);
            }
        }
    };

    const chunks = (window.webpackChunkdiscord_app ??= []);
    chunks.forEach((chunk) => patchModules(chunk?.[1]));
    const previous = Object.getOwnPropertyDescriptor(chunks, "push");
    let current = previous?.value ?? Array.prototype.push;
    Object.defineProperty(chunks, "push", {
        configurable: true,
        get() {
            const target = previous?.get ? previous.get.call(this) : current;
            return function (...items) {
                items.forEach((chunk) => patchModules(chunk?.[1]));
                return target.apply(this, items);
            };
        },
        set(fn) {
            if (previous?.set) previous.set.call(this, fn);
            else current = fn;
        },
    });
})();
