#!/usr/bin/env bash
# Cron-driven dev deploy poller. Install via crontab:
#   * * * * * /home/<user>/Desktop/projects/shuttleMentor/scripts/poll-dev-redeploy.sh
# Polls origin/dev once per minute; on advance, hard-resets local dev,
# redeploys the dev compose stack detached. State (lock, log, last-
# deployed sha) lives in ~/.shuttlementor-dev-poll/ so `git reset --hard`
# cannot wipe it. Container logs are snapshotted to <repo>/logs/ before
# each redeploy (see scripts/snapshot-logs.sh); old snapshots are
# pruned below on every tick (independent of redeploys, so retention
# kicks in even during long quiet periods).

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/Desktop/projects/shuttleMentor}"
BRANCH="dev"
STATE_DIR="$HOME/.shuttlementor-dev-poll"
LOCK_FILE="$STATE_DIR/lock"
LOG_FILE="$STATE_DIR/log"
DEPLOYED_FILE="$STATE_DIR/deployed-sha"

mkdir -p "$STATE_DIR"

# Cron's PATH is minimal; surface node/npm/docker.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Single-instance guard: a redeploy outlives the 1-min cron tick,
# so subsequent ticks must no-op rather than stack.
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$REPO_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"; }

# Retention sweep on every tick (cheap on a small dir). Runs independent
# of redeploys so the 14-day cap holds even when origin/dev is quiet.
find "$REPO_DIR/logs" -name "*.log.gz" -mtime +14 -delete 2>/dev/null || true

if ! git fetch --quiet origin "$BRANCH"; then
  log "fetch failed; retrying next tick"
  exit 0
fi

REMOTE=$(git rev-parse "origin/$BRANCH")
LAST=$(cat "$DEPLOYED_FILE" 2>/dev/null || echo "")

if [ "$LAST" = "$REMOTE" ]; then
  exit 0
fi

log "dev advanced ${LAST:0:7} -> ${REMOTE:0:7}; redeploying"

git checkout "$BRANCH" >> "$LOG_FILE" 2>&1
git reset --hard "$REMOTE" >> "$LOG_FILE" 2>&1

# Surface the deployed SHA + timestamp to the running container via env vars.
# docker-compose.yml substitutes ${BUILD_SHA}/${BUILD_TIMESTAMP} from this
# shell, so /api/health can echo back what's actually running.
export BUILD_SHA="$REMOTE"
export BUILD_TIMESTAMP="$(date -Iseconds)"

# Detached sibling of `docker:dev:redeploy` (see package.json). Pipeline:
#   build → snapshot-logs → stop → up -d → image/container/builder/volume prune
# with `-d` so cron doesn't hang on foreground logs.
#
# Disk hygiene cadence (each step runs every redeploy):
#   - snapshot-logs:dev: gzip current container logs to <repo>/logs/ before
#       `compose down` destroys them. Best-effort; never fails the deploy.
#   - image prune     --filter until=168h: keep one week of old images.
#   - container prune --filter until=168h: plain stopped-container hygiene
#       (logs are already preserved by the snapshot step above).
#   - builder prune   --keep-storage 12G: bound BuildKit cache. Sized from
#       a clean-build measurement: dev image = 2.5GB, dev+prod = ~5GB
#       successfully built; 12G gives ~2x headroom so a redeploy never has
#       to rebuild from scratch. Plain `--force` (no size cap) wipes cache
#       layers immediately after build completes — avoid that in automation.
#   - volumes:prune:dev: cleans the orphan /app/node_modules anonymous volume
#       that the app service creates per redeploy (see docker-compose.yml).
#       Wrapped in `|| true` — its safety guard can race with `up -d`, and a
#       prune-only failure shouldn't cause cron to retry the whole rebuild.
if npm run docker:dev:redeploy:detached >> "$LOG_FILE" 2>&1; then
  echo "$REMOTE" > "$DEPLOYED_FILE"
  log "redeploy ok @ $(git rev-parse --short HEAD)"
else
  log "redeploy FAILED @ ${REMOTE:0:7}; will retry next tick"
  exit 1
fi
