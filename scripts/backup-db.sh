#!/usr/bin/env bash
# Daily logical backup of each RUNNING env's Postgres DB via `pg_dump -Fc`
# (custom format: compressed + supports selective restore). Online — no
# container stop, no restart.
#
# Writes to $BACKUP_DIR which lives OUTSIDE the repo checkout, so the deploy
# poller's `git reset --hard` can never wipe backups (same rationale as the
# poller's own ~/.shuttlementor-main-poll/ state dir). One dump file per env
# per run; the script enforces its own retention.
#
# Exits NONZERO if any running env fails, so cron MAILTO / monitoring notices a
# bad night. Envs whose db container isn't up are skipped (logged, not failed).
#
# Install (low-traffic, ~midnight) via `crontab -e`:
#   0 0 * * * /ABS/PATH/TO/repo/scripts/backup-db.sh >> $HOME/facilitypresence-db-backups/backup.log 2>&1
#
# NOTE: the nightly integrity check here is intentionally light (exit code +
# non-empty file). The REAL guarantee is a periodic restore test — see the
# companion snippet in designFiles/postgres-runbooks.md. Run it monthly.

set -uo pipefail

# Cron's PATH is minimal; surface docker like the pollers do.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-shuttlementor}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/facilitypresence-db-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# env label -> db container name. Add envs here if more are introduced.
ENVS="dev:shuttlementor-db-dev prod:shuttlementor-db-prod"

mkdir -p "$BACKUP_DIR"

# Single-instance guard — a slow dump must never overlap the next tick.
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { echo "$(date -Iseconds) another backup is running; skipping"; exit 0; }

rc=0
for pair in $ENVS; do
  env_name="${pair%%:*}"
  container="${pair##*:}"

  # Skip envs that aren't currently running (auto-handles whichever are up).
  if ! docker ps --format '{{.Names}}' | grep -qx "$container"; then
    echo "$(date -Iseconds) skip: $container not running"
    continue
  fi

  dest="$BACKUP_DIR/$env_name"
  mkdir -p "$dest"
  ts=$(date +%Y%m%d-%H%M%S)
  out="$dest/${DB_NAME}-${env_name}-${ts}.dump"

  if docker exec "$container" pg_dump -U "$DB_USER" -Fc -d "$DB_NAME" > "$out" \
       && [ -s "$out" ]; then
    echo "$(date -Iseconds) ok: $out ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out"
    echo "$(date -Iseconds) ERROR: $env_name pg_dump failed (or produced empty file)"
    rc=1
  fi

  # Retention: prune ONLY this env's old dumps (after a successful write).
  find "$dest" -name "${DB_NAME}-${env_name}-*.dump" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
done

exit $rc
