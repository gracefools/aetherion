#!/usr/bin/env bash
# End-to-end check of the production path, without Docker:
#   fresh database -> bundle -> plain `node dist/server.mjs` -> health -> real clients -> SIGTERM -> data saved.
# Needs PostgreSQL and Redis on localhost (scripts/dev-services.sh starts them on Debian/Ubuntu).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8099}
DB=aetherion_deploycheck
runuser -u postgres -- psql -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER aetherion" >/dev/null
node scripts/build-client.mjs >/dev/null
node scripts/build-server.mjs
export NODE_ENV=production PORT DATABASE_URL="postgres://aetherion:aetherion_dev@127.0.0.1:5432/$DB" METRICS_TOKEN=deploy-check-token
export AUTH_RATE_LIMIT=100000 MAX_CONNECTIONS_PER_IP=1000 RECONNECT_GRACE_MS=2000
node dist/server.mjs > .run/deploy-server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.25; done
echo "health:   $(curl -fsS http://127.0.0.1:$PORT/api/health)"
echo "page:     $(curl -fsS -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1:$PORT/)"
echo "bundle:   $(curl -fsS -o /dev/null -w '%{http_code} %{size_download} bytes' http://127.0.0.1:$PORT/app.js)"
echo "metrics without token: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/metrics)"
echo "metrics with token:    $(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer deploy-check-token' http://127.0.0.1:$PORT/api/metrics)"
# real clients over WebSocket: 20 bots for 15 seconds (registration, characters, parties, combat, loot)
METRICS_TOKEN=deploy-check-token node_modules/.bin/tsx scripts/loadtest.ts 20 15 "http://127.0.0.1:$PORT" > .run/deploy-load.json 2>&1 || { echo "load run failed"; tail -5 .run/deploy-load.json; exit 1; }
grep -E '"(clients|dropped|avg|max|botsThatGainedExp)"' .run/deploy-load.json | tr -d '\n' | sed 's/  */ /g'; echo
# graceful shutdown: SIGTERM must save every player and exit 0
kill -TERM $PID
wait $PID && CODE=0 || CODE=$?
trap - EXIT
echo "exit code after SIGTERM: $CODE"
grep -c "shutting down" .run/deploy-server.log | sed 's/^/shutdown messages logged: /'
Q() { PGPASSWORD=aetherion_dev psql -h 127.0.0.1 -U aetherion -d $DB -Atc "$1"; }
echo "migrations applied: $(Q 'select count(*) from schema_migrations')"
echo "accounts: $(Q 'select count(*) from accounts')  characters: $(Q 'select count(*) from characters')"
echo "characters with saved progress (exp, gold or items): $(Q "select count(*) from characters where exp > 0 or level > 1 or gold > 0 or jsonb_array_length(inventory) > 1")"
echo "characters with equipment saved: $(Q "select count(*) from characters where equipment ? 'weapon'")"
[ "$CODE" = 0 ] && echo "DEPLOY CHECK PASSED" || { echo "DEPLOY CHECK FAILED"; exit 1; }
