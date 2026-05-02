#!/usr/bin/env bash
# Cron-driven dev deploy poller. Install via crontab:
#   * * * * * /home/<user>/Desktop/projects/shuttleMentor/scripts/poll-dev-redeploy.sh
# Polls origin/dev once per minute; on advance, hard-resets local dev,
# redeploys the dev compose stack detached, prunes stopped containers
# (volumes preserved). State (lock, log, last-deployed sha) lives in
# ~/.shuttlementor-dev-poll/ so `git reset --hard` cannot wipe it.

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

# Detached sibling of `docker:dev:redeploy`: same down → image prune → up
# pipeline, but with `-d` (so cron doesn't hang on foreground logs) and a
# trailing `docker container prune -f` for stopped containers.
if npm run docker:dev:redeploy:detached >> "$LOG_FILE" 2>&1; then
  echo "$REMOTE" > "$DEPLOYED_FILE"
  log "redeploy ok @ $(git rev-parse --short HEAD)"
else
  log "redeploy FAILED @ ${REMOTE:0:7}; will retry next tick"
  exit 1
fi
