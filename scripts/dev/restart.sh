#!/bin/sh
cd "$(dirname "$0")/../.."
pids=$(lsof -tiTCP:${PORT:-3001} -sTCP:LISTEN)
[ -n "$pids" ] && kill $pids
while lsof -iTCP:${PORT:-3001} -sTCP:LISTEN >/dev/null; do sleep 1; done
PORT="${PORT:-3001}" WRTC_WS_PORT="${WRTC_WS_PORT:-$((${PORT:-3001} + 1000))}" LOG_REQUESTS="${LOG_REQUESTS:-400,401,403,404,405,409,413,429,500,501,502,503}" nohup node -r dotenv/config -r module-alias/register --enable-source-maps dist/bundle/start.js > "${SERVER_LOG:-/tmp/fosscord-server.log}" 2>&1 &
until curl -sf localhost:${PORT:-3001}/api/ping >/dev/null; do sleep 1; done
echo "server up, log at ${SERVER_LOG:-/tmp/fosscord-server.log}"
