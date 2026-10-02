(() => {
    const knownId = "573648";
    const isPlatforms = (value) => typeof value?.map === "function" && typeof value?.isSupported === "function" && typeof value?.getByUrl === "function";
    let require;
    (window.webpackChunkdiscord_app ??= []).push([[Symbol("fosscord-connections")], {}, (r) => (require = r)]);

    const findPlatforms = () => {
        if (!require?.m) return undefined;
        const ids = require.m[knownId] ? [knownId] : Object.keys(require.m).filter((id) => String(require.m[id]).includes('name:"Crunchyroll"'));
        for (const id of ids) {
            const found = Object.values(require(id) ?? {}).find(isPlatforms);
            if (found) return found;
        }
        return undefined;
    };

    const config = fetch(`${window.GLOBAL_ENV?.API_ENDPOINT ?? "/api"}/v${window.GLOBAL_ENV?.API_VERSION ?? 9}/connections`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);

    let attempts = 0;
    const timer = setInterval(async () => {
        const platforms = findPlatforms();
        if (!platforms && ++attempts < 120) return;
        clearInterval(timer);
        const enabled = await config;
        if (!platforms || !enabled) return;
        platforms.map((platform) => {
            if (platform.enabled && !enabled[platform.type]?.enabled) platform.enabled = false;
            return platform;
        });
    }, 500);
})();
