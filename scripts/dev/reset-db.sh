#!/bin/sh
cd "$(dirname "$0")/../.."
db="${DB_NAME:-fosscord}"
pids=$(lsof -tiTCP:${PORT:-3001} -sTCP:LISTEN)
[ -n "$pids" ] && kill $pids
while lsof -iTCP:${PORT:-3001} -sTCP:LISTEN >/dev/null; do sleep 1; done
dropdb --if-exists "$db" && createdb "$db"
