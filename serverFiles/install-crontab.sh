#!/usr/bin/env bash
# Idempotent installer for the server's crontab from the committed canonical file
# (serverFiles/crontab). Safe to re-run any number of times — it FULL-REPLACES the
# user crontab so the box always matches the repo (drift can't survive a re-run).
#
# Usage:
#   serverFiles/install-crontab.sh           # install / re-sync (full replace)
#   serverFiles/install-crontab.sh --check    # report drift only; exit 1 if drifted
#   serverFiles/install-crontab.sh --dry-run   # show what WOULD be installed; no change
#
# Bootstrapping a brand-new server:
#   1. Clone the repo to the canonical paths (see paths inside serverFiles/crontab).
#   2. Run this script from either clone. It installs ALL jobs in one shot.
#
# Drift protection (cron is invisible to git, so it drifts silently):
#   * Run `--check` from a cron job or by hand to catch out-of-band edits.
#   * To fix drift: edit serverFiles/crontab, commit, re-run this installer.
#
# WHY full-replace instead of append/merge: appending is not idempotent (re-runs
# duplicate lines) and merging can't remove a job you deleted from the canonical
# file. `crontab <file>` makes the live crontab byte-for-byte equal to the source.

set -euo pipefail

# Resolve repo paths relative to this script so it works from any clone / cwd.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CANON="$SCRIPT_DIR/crontab"
BACKUP_DIR="$HOME/.shuttlementor-crontab-backups"

mode="install"
case "${1:-}" in
  --check)   mode="check" ;;
  --dry-run) mode="dry-run" ;;
  "")        mode="install" ;;
  *) echo "usage: $0 [--check|--dry-run]" >&2; exit 2 ;;
esac

[ -f "$CANON" ] || { echo "ERROR: canonical crontab not found at $CANON" >&2; exit 2; }

# --- Validate every script the crontab references actually exists & is runnable.
# Pull the absolute /.../scripts/*.sh token out of each non-comment line.
missing=0
while IFS= read -r script; do
  [ -n "$script" ] || continue
  if [ ! -f "$script" ]; then
    echo "WARN: referenced script does not exist: $script" >&2; missing=1
  elif [ ! -x "$script" ]; then
    echo "WARN: referenced script is not executable (chmod +x): $script" >&2; missing=1
  fi
done < <(grep -vE '^\s*#|^\s*$' "$CANON" | grep -oE '/[^ ]*/scripts/[A-Za-z0-9._-]+\.sh' | sort -u)

if [ "$missing" -ne 0 ]; then
  echo "NOTE: one or more referenced scripts are missing/not-executable on this box." >&2
  echo "      They must be committed to the branch each clone tracks (poller resets --hard)." >&2
fi

# --- Render what the live crontab SHOULD be (strip nothing; install verbatim).
desired="$(cat "$CANON")"
live="$(crontab -l 2>/dev/null || true)"

case "$mode" in
  check)
    if [ "$live" = "$desired" ]; then
      echo "OK: live crontab matches $CANON (no drift)."
      exit 0
    fi
    echo "DRIFT: live crontab differs from $CANON" >&2
    echo "--- diff (live <  > canonical) ---" >&2
    diff <(printf '%s\n' "$live") <(printf '%s\n' "$desired") >&2 || true
    exit 1
    ;;
  dry-run)
    echo "Would install the following crontab (full replace):"
    echo "------------------------------------------------------------"
    printf '%s\n' "$desired"
    echo "------------------------------------------------------------"
    if [ "$live" = "$desired" ]; then echo "(no change — already in sync)"; fi
    exit 0
    ;;
  install)
    if [ "$live" = "$desired" ]; then
      echo "Already in sync — live crontab matches $CANON. Nothing to do."
      exit 0
    fi
    # Back up the existing crontab before replacing (timestamped, outside repo).
    mkdir -p "$BACKUP_DIR"
    if [ -n "$live" ]; then
      ts="$(date +%Y%m%d-%H%M%S)"
      printf '%s\n' "$live" > "$BACKUP_DIR/crontab-$ts.bak"
      echo "Backed up existing crontab -> $BACKUP_DIR/crontab-$ts.bak"
    fi
    crontab "$CANON"
    echo "Installed crontab from $CANON. New live crontab:"
    echo "------------------------------------------------------------"
    crontab -l
    echo "------------------------------------------------------------"
    ;;
esac
