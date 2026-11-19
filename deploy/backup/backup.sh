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
  # pg_dump compresses by itself, so its own exit status decides (a pipe would report gzip's)
  if pg_dump --clean --if-exists --no-owner -Z 6 -h postgres -U aetherion -f "$f.part" aetherion && [ -s "$f.part" ]; then
    mv "$f.part" "$f"
    echo "backup written: $f ($(du -h "$f" | cut -f1))"
    wait_s=$((EVERY * 3600))
  else
    rm -f "$f.part"
    echo "backup FAILED at $(date -u); trying again in 5 minutes" >&2
    wait_s=300
  fi
  # an empty gzip (20 bytes) is a failed backup from before this check; a real dump is kilobytes
  find /backups -name 'aetherion-*.sql.gz' -size -100c -delete
  ls -1t /backups/aetherion-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  sleep "$wait_s"
done
