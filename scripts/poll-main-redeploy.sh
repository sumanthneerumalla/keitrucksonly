#!/usr/bin/env bash
# Cron-driven prod deploy poller. Install via crontab:
#   * * * * * /home/<user>/Desktop/projects/shuttleMentor/scripts/poll-main-redeploy.sh
# Polls origin/main once per minute; on advance, hard-resets local main,
# redeploys the prod compose stack detached. State (lock, log, last-
# deployed sha) lives in ~/.shuttlementor-main-poll/ so `git reset --hard`
# cannot wipe it. Container logs are snapshotted to <repo>/logs/ before
# each redeploy (see scripts/snapshot-logs.sh); old snapshots are
# pruned below on every tick (independent of redeploys).
#
# Run alongside poll-dev-redeploy.sh ONLY if each poller is pointed at its
# own clone (via REPO_DIR); otherwise the two will fight over HEAD in the
# same checkout — dev's bind mounts would intermittently serve main's code.

# Bash buffers the entire {...} body before executing — safe against `git reset --hard` rewriting this file mid-deploy.
{
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/Desktop/projects/shuttleMentor}"
BRANCH="main"
STATE_DIR="$HOME/.shuttlementor-main-poll"
LOCK_FILE="$STATE_DIR/lock"
LOG_FILE="$STATE_DIR/log"
DEPLOYED_FILE="$STATE_DIR/deployed-sha"

mkdir -p "$STATE_DIR"

# Cron's PATH is minimal; surface node/npm/docker.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Single-instance guard: a prod redeploy outlives the 1-min cron tick,
# so subsequent ticks must no-op rather than stack.
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$REPO_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"; }

# Retention sweep on every tick (cheap on a small dir). Runs independent
# of redeploys so the 14-day cap holds even when origin/main is quiet.
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

log "main advanced ${LAST:0:7} -> ${REMOTE:0:7}; redeploying prod"

git checkout "$BRANCH" >> "$LOG_FILE" 2>&1
git reset --hard "$REMOTE" >> "$LOG_FILE" 2>&1

# Surface the deployed SHA + timestamp to the running container via env vars.
# docker-compose.yml substitutes ${BUILD_SHA}/${BUILD_TIMESTAMP} from this
# shell, so /api/health can echo back what's actually running.
export BUILD_SHA="$REMOTE"
export BUILD_TIMESTAMP="$(date -Iseconds)"

# Phased redeploy. See poll-dev-redeploy.sh for full rationale on the
# disk-hygiene cadence (kept identical here for predictable host disk usage)
# and the rationale for probing health between `up` and `cleanup`.
T_TOTAL_START=$SECONDS

T0=$SECONDS
npm run docker:prod:build >> "$LOG_FILE" 2>&1 \
  || { log "build failed @ ${REMOTE:0:7}; will retry next tick"; exit 1; }
T_BUILD=$((SECONDS - T0))

T0=$SECONDS
npm run docker:prod:redeploy:up >> "$LOG_FILE" 2>&1 \
  || { log "up failed @ ${REMOTE:0:7}; will retry next tick"; exit 1; }
T_DEPLOY=$((SECONDS - T0))

# Probe via Caddy + DNS — exercises the full user-visible request path,
# not just `localhost:3001`. Times "container started" → "site live".
T0=$SECONDS
while ! curl -fs https://www.facilitypresence.com/api/health >/dev/null 2>&1; do
  sleep 2
  if [ $((SECONDS - T0)) -gt 180 ]; then
    log "health timeout after 180s @ ${REMOTE:0:7}; will retry next tick"
    exit 1
  fi
done
T_HEALTH=$((SECONDS - T0))

# Cleanup runs untimed — doesn't affect user-visible deploy duration.
npm run docker:prod:redeploy:cleanup >> "$LOG_FILE" 2>&1 || true

T_TOTAL=$((SECONDS - T_TOTAL_START))

# Write per-phase timing JSON into the running container via `docker exec` —
# no bind mount. Atomic temp+mv inside the container so /api/health never
# reads a partial file. Best-effort: write failure logs a warning but
# doesn't fail the deploy.
JSON=$(printf '{"deployedAt":"%s","deployedSha":"%s","buildSeconds":%d,"deploySeconds":%d,"healthSeconds":%d,"totalSeconds":%d}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(git rev-parse --short HEAD)" \
  "$T_BUILD" "$T_DEPLOY" "$T_HEALTH" "$T_TOTAL")
echo "$JSON" | docker exec -i shuttlementor-app-prod sh -c \
  'cat > /app/.deploy-info.json.tmp && mv /app/.deploy-info.json.tmp /app/.deploy-info.json' \
  >> "$LOG_FILE" 2>&1 \
  || log "warning: failed to write deploy info into container @ ${REMOTE:0:7}"

echo "$REMOTE" > "$DEPLOYED_FILE"
log "redeploy ok @ $(git rev-parse --short HEAD) (build:${T_BUILD}s deploy:${T_DEPLOY}s health:${T_HEALTH}s total:${T_TOTAL}s)"
}
