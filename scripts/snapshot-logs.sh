#!/usr/bin/env bash
# Best-effort snapshot of docker container logs to <repo>/logs/ before
# the redeploy chain destroys the running container. Without this, the
# default json-file driver loses logs every time `docker compose up -d`
# recreates a container due to image changes — i.e. every deploy.
#
# Called by `docker:dev:redeploy{,:detached}` and prod equivalents in
# package.json. Never aborts the caller; on failure it logs to stderr
# and exits 0 so the redeploy chain proceeds. Retention is enforced
# from the cron poll scripts (find -mtime +14 -delete every minute),
# not here, so it works even when redeploys are paused.

set -o pipefail

ENV="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SHA="${BUILD_SHA:-unknown}"

mkdir -p "$LOG_DIR" 2>/dev/null

for container in "shuttlementor-app-$ENV" "shuttlementor-db-$ENV"; do
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$container" || continue
  out="$LOG_DIR/${container}-${TIMESTAMP}-${SHA:0:7}.log.gz"
  if docker logs --timestamps "$container" 2>&1 | gzip > "$out" 2>/dev/null; then
    echo "snapshot: $out"
  else
    rm -f "$out"
    echo "snapshot failed: $container" >&2
  fi
done

exit 0
