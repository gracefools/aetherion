#!/bin/sh
# Database backups: a compressed pg_dump of the game database every BACKUP_EVERY_HOURS (default 6),
# keeping the newest BACKUP_KEEP files (default 28, one week at the default rate). Files land in
# /backups, which docker-compose maps to deploy/backups on the host.
#
# Restore one (stops nothing by itself; stop the game service first):
#   gunzip -c deploy/backups/aetherion-YYYYmmdd-HHMM.sql.gz | docker compose -f deploy/docker-compose.yml exec -T postgres psql -U aetherion -d aetherion
set -eu
EVERY=${BACKUP_EVERY_HOURS:-6}
KEEP=${BACKUP_KEEP:-28}
mkdir -p /backups
while true; do
  f="/backups/aetherion-$(date -u +%Y%m%d-%H%M).sql.gz"
  if pg_dump --clean --if-exists --no-owner -h postgres -U aetherion aetherion | gzip -6 > "$f.part"; then
    mv "$f.part" "$f"
    echo "backup written: $f ($(du -h "$f" | cut -f1))"
  else
    rm -f "$f.part"
    echo "backup FAILED at $(date -u)" >&2
  fi
  ls -1t /backups/aetherion-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  sleep $((EVERY * 3600))
done
