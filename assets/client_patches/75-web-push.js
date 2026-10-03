(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !window.isSecureContext) return;
    const storage = window.localStorage;
    const scope = "/notifications-sw/";
    const api = `${location.origin}/api/v${window.GLOBAL_ENV?.API_VERSION ?? 9}`;
    const readToken = () => {
        try {
            return JSON.parse(storage.getItem("token") ?? "null");
        } catch {
            return null;
        }
    };
    const decodeKey = (key) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const sameKey = (a, b) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((byte, i) => byte === b[i]);
    const activated = (registration) =>
        registration.active
            ? Promise.resolve(registration)
            : new Promise((resolve) => {
                  const worker = registration.installing ?? registration.waiting;
                  worker?.addEventListener("statechange", () => worker.state === "activated" && resolve(registration));
              });

    let synced = null;
    let running = false;
    const sync = async () => {
        if (running) return;
        running = true;
        try {
            const token = readToken();
            const existing = (await navigator.serviceWorker.getRegistrations()).find((registration) => registration.scope === new URL(scope, location.origin).href);
            if (!token) {
                synced = null;
                await (await existing?.pushManager.getSubscription())?.unsubscribe();
                return;
            }
            if (Notification.permission !== "granted") return;
            const config = await fetch(`${api}/users/@me/devices/web-push`, { headers: { authorization: token } }).then((res) => (res.ok ? res.json() : null));
            if (!config?.enabled || !config.public_key) return;

            const registration = await activated(existing ?? (await navigator.serviceWorker.register("/notifications-sw.js", { scope })));
            const key = decodeKey(config.public_key);
            let subscription = await registration.pushManager.getSubscription();
            if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
                await subscription.unsubscribe();
                subscription = null;
            }
            subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
            const serialized = JSON.stringify(subscription);
            if (synced === `${token}\n${serialized}`) return;
            const res = await fetch(`${api}/users/@me/devices`, {
                method: "POST",
                headers: { authorization: token, "content-type": "application/json" },
                body: JSON.stringify({ provider: "webpush", token: serialized }),
            });
            if (res.ok) synced = `${token}\n${serialized}`;
        } catch (e) {
            console.warn("[WebPush] subscription failed:", e);
        } finally {
            running = false;
        }
    };

    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type !== "fosscord-notification-click" || typeof event.data.path !== "string" || !event.data.path.startsWith("/channels/")) return;
        history.pushState(history.state, "", event.data.path);
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    });
    navigator.permissions
        ?.query({ name: "notifications" })
        .then((status) => status.addEventListener("change", sync))
        .catch(() => {});

    let lastToken = readToken();
    setInterval(() => {
        const token = readToken();
        if (token === lastToken) return;
        lastToken = token;
        sync();
    }, 5000);
    setTimeout(sync, 3000);
})();
