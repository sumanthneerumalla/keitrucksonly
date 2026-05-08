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

# Detached sibling of `docker:prod:redeploy` (see package.json). Pipeline:
#   build → snapshot-logs → stop → up -d → image/container/builder/volume prune
# with `-d` so cron doesn't hang on foreground logs.
#
# Disk hygiene cadence — kept identical to dev so a single host running both
# pollers has predictable steady-state disk usage. See poll-dev-redeploy.sh
# for the rationale behind each step (snapshot, builder prune --keep-storage
# 12G sized from a clean-build measurement, volume prune wrapped to be
# non-fatal, etc.).
if npm run docker:prod:redeploy:detached >> "$LOG_FILE" 2>&1; then
  echo "$REMOTE" > "$DEPLOYED_FILE"
  log "redeploy ok @ $(git rev-parse --short HEAD)"
else
  log "redeploy FAILED @ ${REMOTE:0:7}; will retry next tick"
  exit 1
fi
