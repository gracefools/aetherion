#!/usr/bin/env bash
# Starts local PostgreSQL 16 + Redis and creates the dev/test databases (Debian/Ubuntu layout).
set -euo pipefail
pg_ctlcluster 16 main start 2>/dev/null || true
sleep 1
as_pg() { runuser -u postgres -- psql -v ON_ERROR_STOP=0 -q "$@"; }
as_pg -c "CREATE ROLE aetherion LOGIN PASSWORD 'aetherion_dev'" 2>/dev/null || true
as_pg -c "CREATE DATABASE aetherion OWNER aetherion" 2>/dev/null || true
as_pg -c "CREATE DATABASE aetherion_test OWNER aetherion" 2>/dev/null || true
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes --save "" >/dev/null
echo "postgres: $(pg_isready -h 127.0.0.1 | cut -d' ' -f3-)   redis: $(redis-cli ping)"
