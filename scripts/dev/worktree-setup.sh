#!/bin/sh
set -e
cd "$(dirname "$0")/../.."
port="${1:?usage: worktree-setup.sh <port> <db-name>}"
db="${2:?usage: worktree-setup.sh <port> <db-name>}"
main="$(git worktree list --porcelain | awk 'NR==1{print $2}')"
[ -e node_modules ] || ln -s "$main/node_modules" node_modules
[ -e assets/cache ] || ln -s "$main/assets/cache" assets/cache
[ -e assets/cache_compressed ] || [ ! -d "$main/assets/cache_compressed" ] || ln -s "$main/assets/cache_compressed" assets/cache_compressed
cat > .env <<ENV
DATABASE=postgres://$USER@localhost:5432/$db
PORT=$port
WRTC_WS_PORT=$((port + 1000))
NODE_ENV=development
CONFIG_PATH=$PWD/config.json
ENV
if command -v go >/dev/null && (cd extra/pion-sfu && go build -o pion-sfu .); then
    cat >> .env <<ENV
PION_SFU_BIN=$PWD/extra/pion-sfu/pion-sfu
WRTC_PUBLIC_IP=127.0.0.1
WRTC_PORT_MIN=$((port + 2000))
WRTC_PORT_MAX=$((port + 2000))
ENV
fi
cat > config.json <<JSON
{
  "general": { "serverName": "http://localhost:$port" },
  "api": { "endpointPublic": "http://localhost:$port/api/v9" },
  "cdn": { "endpointPublic": "http://localhost:$port/", "endpointPrivate": "http://localhost:$port/" },
  "gateway": { "endpointPublic": "ws://localhost:$port/" }
}
JSON
pids=$(lsof -tiTCP:$port -sTCP:LISTEN || true)
[ -n "$pids" ] && kill $pids
dropdb --if-exists "$db"
createdb "$db"
npm run build:src >/dev/null
PORT=$port SERVER_LOG="$PWD/server.log" scripts/dev/restart.sh
PORT=$port node scripts/dev/seed.mjs
echo "ready: http://fosscord.localhost:$port, db $db, log $PWD/server.log"
