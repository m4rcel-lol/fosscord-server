(() => {
    // Users with the spacebar AI_ACCOUNT public flag (1 << 30) get the client's dormant AI tag type instead of BOT,
    // rendered green with "AI". VERIFIED_BOT still adds the check mark, giving "✓ AI".
    const AI_FLAG = 1073741824;
    const rules = [
        // shared helper behind profile/member-list tags: isSystemUser() ? SYSTEM_DM : bot ? BOT
        [/([\w$]+)\.bot&&\(([\w$]+)=([\w$]+)\.nu\.BOT\)/g, `($1.publicFlags&${AI_FLAG})?$2=$3.nu.AI:$1.bot&&($2=$3.nu.BOT)`],
        // message header tag: ...: author?.bot ? BOT : ...
        [/([\w$]+)\?\.bot\?([\w$]+)=([\w$]+)\.A\.Types\.BOT:/g, `($1?.publicFlags&${AI_FLAG})?$2=$3.A.Types.AI:$1?.bot?$2=$3.A.Types.BOT:`],
        // the tag renderer: label "AI", green, "Verified AI" tooltip. f is the tooltip, p the colour class, I the label
        [
            /([\w$]+)=([\w$]+)\.intl\.string\(\2\.t\.g76OcH\),([\w$]+)=([\w$]+)\?([\w$]+\.[\w$]+):([\w$]+\.[\w$]+);switch\(([\w$]+)\)\{/g,
            `$1=$2.intl.string($2.t.g76OcH),$3=$4?$5:$6;if($7===7){$1="Verified AI",$3=$3+" sb-ai-tag"}switch($7){`,
        ],
        [/case ([\w$]+)\.nu\.BOT:default:([\w$]+)=/g, `case $1.nu.AI:$2="AI";break;case $1.nu.BOT:default:$2=`],
    ];
    const needles = [".nu.BOT", ".Types.BOT", "g76OcH"];

    const style = document.createElement("style");
    style.textContent = ".sb-ai-tag{background:#23a55a!important;color:#fff!important}";
    (document.head || document.documentElement).append(style);

    const patchModules = (modules) => {
        if (!modules || typeof modules !== "object") return;
        for (const id of Object.keys(modules)) {
            const factory = modules[id];
            if (typeof factory !== "function" || factory.__aiTagPatched) continue;
            const source = factory.toString();
            if (!needles.some((needle) => source.includes(needle))) continue;
            const patched = rules.reduce((code, [find, replace]) => code.replace(find, replace), source);
            if (patched === source) continue;
            try {
                const replacement = (0, eval)(`({${patched}})`)[id] ?? (0, eval)(`(${patched})`);
                replacement.__aiTagPatched = true;
                modules[id] = replacement;
            } catch (e) {
                console.error("[ai-tag] failed to patch module", id, e);
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

    // the tag renderer lives in the entry bundle, which never goes through chunk push. A queued chunk's runtime
    // callback runs with webpack's require during startup, before any module executes, so patch the registry there
    chunks.push([["sb-ai-tag"], {}, (require) => patchModules(require.m)]);
})();
