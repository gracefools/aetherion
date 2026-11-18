#!/usr/bin/env bash
# Entrypoint of the dev/test image (deploy/Dockerfile.dev): starts a throwaway PostgreSQL 16 and
# Redis inside the container, creates the dev and test databases, makes sure /app/node_modules is
# populated, then runs the given command. Nothing here is used in production.
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/var/lib/postgresql/devdata
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  install -d -o postgres -g postgres "$PGDATA"
  gosu postgres "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth-local=trust --auth-host=scram-sha-256 >/dev/null
fi
gosu postgres "$PGBIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=200" -w start >/dev/null
as_pg() { gosu postgres psql -v ON_ERROR_STOP=0 -q "$@" 2>/dev/null || true; }
as_pg -c "CREATE ROLE aetherion LOGIN PASSWORD 'aetherion_dev'"
as_pg -c "CREATE DATABASE aetherion OWNER aetherion"
as_pg -c "CREATE DATABASE aetherion_test OWNER aetherion"
redis-server --daemonize yes --save "" --appendonly no >/dev/null
# node_modules lives in a named volume so Linux binaries never land in the Windows checkout
if [ -d /app ] && [ ! -e /app/node_modules/.bin/tsx ]; then
  mkdir -p /app/node_modules
  cp -a /opt/deps/node_modules/. /app/node_modules/
fi
mkdir -p /app/.run 2>/dev/null || true
exec "$@"
