(() => {
    const rules = [
        [/\((\w+)\.X\.BILLING_SECTION,\{(?!usePredicate)/g, "($1.X.BILLING_SECTION,{usePredicate:()=>!1,"],
        [/\((\w+)\.X\.ACCOUNT_FAMILY_CENTER_CATEGORY,\{(?!usePredicate)/g, "($1.X.ACCOUNT_FAMILY_CENTER_CATEGORY,{usePredicate:()=>!1,"],
        [/(=function\(\)\{)(let [^;]{0,80}?=\(0,\w+\.\w+\)\(\w+\.\w+\.COLLECTIBLES_PROFILE_SETTINGS_UPSELL\))/g, "$1return null;$2"],
    ];
    const needles = ["BILLING_SECTION", "ACCOUNT_FAMILY_CENTER_CATEGORY", "COLLECTIBLES_PROFILE_SETTINGS_UPSELL"];

    const patchModules = (modules) => {
        if (!modules || typeof modules !== "object") return;
        for (const id of Object.keys(modules)) {
            const factory = modules[id];
            if (typeof factory !== "function" || factory.__premiumPatched) continue;
            const source = factory.toString();
            if (!needles.some((needle) => source.includes(needle))) continue;
            const patched = rules.reduce((code, [find, replace]) => code.replace(find, replace), source);
            if (patched === source) continue;
            try {
                const replacement = (0, eval)(`({${patched}})`)[id] ?? (0, eval)(`(${patched})`);
                replacement.__premiumPatched = true;
                modules[id] = replacement;
            } catch (e) {
                console.error("[premium-settings] failed to patch module", id, e);
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
