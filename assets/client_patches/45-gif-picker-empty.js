(() => {
    const rules = [
        [
            /GIF_PICKER_TRENDING_FETCH_SUCCESS:function\(([\w$]+)\)\{/g,
            "GIF_PICKER_TRENDING_FETCH_SUCCESS:function($1){window.__sbGifTrendingEmpty=0===$1.trendingCategories.length&&null==$1.trendingGIFPreview;",
        ],
        [
            /return 0===([\w$]+)\.length\?\(0,([\w$]+)\.jsx\)\(([\w$]+),\{columns:([\w$]+),width:([\w$]+),renderColumn:([\w$]+)\}\)/g,
            "return 0===$1.length&&!window.__sbGifTrendingEmpty?(0,$2.jsx)($3,{columns:$4,width:$5,renderColumn:$6})",
        ],
    ];
    const needles = ["GIF_PICKER_TRENDING_FETCH_SUCCESS:function", "renderColumn:"];

    const patchModules = (modules) => {
        if (!modules || typeof modules !== "object") return;
        for (const id of Object.keys(modules)) {
            const factory = modules[id];
            if (typeof factory !== "function" || factory.__sbGifPatched) continue;
            const source = factory.toString();
            if (!needles.some((needle) => source.includes(needle))) continue;
            const patched = rules.reduce((code, [find, replace]) => code.replace(find, replace), source);
            if (patched === source) continue;
            try {
                const replacement = (0, eval)(`({${patched}})`)[id] ?? (0, eval)(`(${patched})`);
                replacement.__sbGifPatched = true;
                modules[id] = replacement;
            } catch (e) {
                console.error("[gif-picker] failed to patch module", id, e);
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
    chunks.push([["sb-gif-picker"], {}, (require) => patchModules(require.m)]);
})();
