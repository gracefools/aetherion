#!/usr/bin/env bash
# Gradual load test and soak test against the production bundle.
#   scripts/capacity.sh ramp            -> 50, 100, 150, 200, 250, 300 clients, 45 s each
#   scripts/capacity.sh soak [N] [SEC]  -> N clients (default 150) for SEC seconds (default 600), sampling server memory
# Bots run on the same machine as the server, so they compete with it for CPU: results are a lower bound.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-ramp}; PORT=8098
export NODE_ENV=production PORT AUTH_RATE_LIMIT=1000000 MAX_CONNECTIONS_PER_IP=100000 DATABASE_URL="postgres://aetherion:aetherion_dev@127.0.0.1:5432/aetherion"
[ -f dist/server.mjs ] || node scripts/build-server.mjs
node dist/server.mjs > .run/capacity-server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.25; done
mem() { ps -o rss= -p $PID | awk '{printf "%.0f", $1/1024}'; }
if [ "$MODE" = ramp ]; then
  echo "clients avgMs p95Ms p99Ms maxMs lateTicks dropped kbpsDown visible rssMB"
  for N in 50 100 150 200 250 300; do
    node_modules/.bin/tsx scripts/loadtest.ts $N 45 "http://127.0.0.1:$PORT" > .run/ramp-$N.json 2>&1 || true
    node -e '
      const t=require("fs").readFileSync(process.argv[1],"utf8"); const j=JSON.parse(t.slice(t.indexOf("{")));
      console.log([j.clients,j.serverTickMs.avg,j.serverTickMs.p95,j.serverTickMs.p99,j.serverTickMs.max,j.lateTicks,j.dropped,j.kBpsDownPerClient,j.avgVisiblePlayersPerClient,process.argv[2]].join(" "))' .run/ramp-$N.json "$(mem)"
    sleep 14   # let the previous wave log out (10 s reconnect grace)
  done
else
  N=${2:-150}; SEC=${3:-600}
  echo "soak: $N clients for $SEC s"
  node_modules/.bin/tsx scripts/loadtest.ts $N $SEC "http://127.0.0.1:$PORT" > .run/soak.json 2>&1 &
  LT=$!
  echo "t_s rssMB tick_avg tick_p99 tick_max players"
  T=0
  while kill -0 $LT 2>/dev/null; do
    M=$(curl -fsS "http://127.0.0.1:$PORT/api/metrics" || echo '{}')
    echo "$T $(mem) $(node -e 'const j=JSON.parse(process.argv[1]||"{}"); const t=j.tickMs||{}; console.log([t.avg,t.p99,t.max,j.players].join(" "))' "$M")"
    sleep 30; T=$((T+30))
  done
  node -e 'const t=require("fs").readFileSync(".run/soak.json","utf8"); const j=JSON.parse(t.slice(t.indexOf("{"))); console.log("result:", JSON.stringify({clients:j.clients,seconds:j.seconds,dropped:j.dropped,tick:j.serverTickMs,lateTicks:j.lateTicks,kbps:j.kBpsDownPerClient}))'
fi
kill -TERM $PID; wait $PID || true; trap - EXIT
echo "server exited cleanly"
