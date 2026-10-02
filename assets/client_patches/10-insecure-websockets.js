(() => {
    if (location.protocol !== "http:") return;
    window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, [url, ...rest]) {
            return new target(String(url).replace(/^wss:\/\//, "ws://"), ...rest);
        },
    });
})();
