#!/bin/sh
set -e
cd /app

case "${1:-server}" in
client)
    mkdir -p /data/client/cache /data/client/cache_compressed
    if [ -f assets/cache/index.html ] && [ "$2" != "--force" ]; then
        echo "[client] using the cached client, run the client service with --force to fetch the current one"
        exec node scripts/compress-client.js
    fi
    node scripts/client.js
    node scripts/e2ee-anchors.js || echo "[client] warning: e2ee anchors are missing from this client build, encrypted DMs stay unavailable until client/e2ee is updated"
    node scripts/clan-badges.js || echo "[client] warning: could not extract server tag badges from this client build"
    node scripts/compress-client.js
    ;;
server)
    if [ ! -f assets/cache/index.html ]; then
        echo "[server] the client cache is empty, start the client service first" >&2
        exit 1
    fi
    node scripts/docker-configure.js
    cd /data/state
    exec node --enable-source-maps /app/dist/bundle/start.js
    ;;
*)
    exec "$@"
    ;;
esac
