# Postgres Runbooks (Concrete Drafts)

**Created:** 2026-05-27
**Status:** 🚧 **PROPOSED — NOTHING HERE IS IMPLEMENTED YET.** These are draft artifacts
(scripts, cron lines, command sequences) to review before we build them. Companion to
`postgres-maintenance-plan.md` (the staged backlog / "what & why"). This doc is the "how".

> ⚠️ Every script and command below is a **draft to be validated on the box**, not a
> committed/working artifact. Paths, container names, and creds are filled in from the
> current compose setup but must be confirmed before first real run.

## Conventions reused from existing scripts

Drafts follow the idioms already in `scripts/`:
- `#!/usr/bin/env bash`, leading rationale comment block (see `snapshot-logs.sh`).
- `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`.
- Container naming `shuttlementor-{app,db}-{dev,prod}`; existence check via `docker ps -a --format '{{.Names}}' | grep -qx`.
- State/output that must survive `git reset --hard` lives **outside the checkout**, under
  `$HOME/...` (the poller keeps its state in `~/.shuttlementor-main-poll/` for exactly this reason).
- `flock` single-instance guard for anything cron-driven that can outlive a tick.
- Retention via `find ... -mtime +N -delete`.
- Cron PATH is minimal → source nvm + export PATH at the top (see `poll-main-redeploy.sh`).

---

## A. Config hygiene (Stage 1) — exact changes

### A1. Pin the bare-metal local script

`start-database.sh:83` — replace the unpinned image:

```diff
-  docker.io/postgres && echo "Database container '$DB_CONTAINER_NAME' was successfully created"
+  docker.io/postgres:15-alpine && echo "Database container '$DB_CONTAINER_NAME' was successfully created"
```

Keeps bare-metal local dev on the same major as the compose stack
(`docker-compose.yml:54`). Revisit when we bump the compose pin.

### A2. Patch-tag policy (pick one, then document the choice in the plan)

- **Option A — exact pin (deliberate bumps):** `docker-compose.yml:54` → `postgres:15.8-alpine`.
  Predictable; requires editing the tag to take patches. **Caveat:** a tag edit is auto-deployed
  by the poller in ~60s — fine for a patch (same data format), dangerous for a major (see Stage 4).
- **Option B — floating tag + pull cadence (recommended):** keep `postgres:15-alpine`, add the
  pull step in §C so patches actually land.

---

## B. Backup script + cron (Stage 2) — **P0**

### B1. Proposed `scripts/backup-db.sh`

```bash
#!/usr/bin/env bash
# Logical backup of the prod Postgres DB via `pg_dump -Fc` (custom format:
# compressed + selective restore). Writes to $BACKUP_DIR OUTSIDE the repo
# checkout so the poller's `git reset --hard` can never wipe it (same
# rationale as ~/.shuttlementor-main-poll/). Enforces its own retention.
#
# Unlike snapshot-logs.sh (best-effort, exits 0), this EXITS NONZERO on
# failure so cron MAILTO / monitoring notices a missed backup.
#
# Install via cron (see header of poll-main-redeploy.sh for the pattern):
#   30 3 * * * /home/<user>/.../scripts/backup-db.sh >> $HOME/shuttlementor-backups/backup.log 2>&1

set -euo pipefail

# Cron PATH is minimal; surface docker/node like the pollers do.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

DB_CONTAINER="${DB_CONTAINER:-shuttlementor-db-prod}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-shuttlementor}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/shuttlementor-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

# Single-instance guard — a slow dump must not overlap the next cron tick.
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { echo "$(date -Iseconds) another backup is running; skipping"; exit 0; }

# Refuse to run if the db container isn't up (don't write a 0-byte "backup").
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" || {
  echo "$(date -Iseconds) ERROR: $DB_CONTAINER not running"; exit 1; }

TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/${DB_NAME}-prod-${TS}.dump"

# -Fc custom format; no -t (no TTY under cron).
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc -d "$DB_NAME" > "$OUT"; then
  # Integrity probe: a dump pg_restore can't even list is worthless.
  if docker exec -i "$DB_CONTAINER" pg_restore --list - < "$OUT" >/dev/null 2>&1; then
    echo "$(date -Iseconds) ok: $OUT ($(du -h "$OUT" | cut -f1))"
  else
    echo "$(date -Iseconds) ERROR: dump unreadable by pg_restore --list; keeping for inspection"; exit 1
  fi
else
  rm -f "$OUT"
  echo "$(date -Iseconds) ERROR: pg_dump failed"; exit 1
fi

# Retention: prune dumps older than N days (only after a successful write).
find "$BACKUP_DIR" -name "${DB_NAME}-prod-*.dump" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
```

Notes / open decisions:
- **Destination outside the checkout** (`$HOME/shuttlementor-backups`) on purpose — `logs/`
  is wrong (the poller prunes `logs/*.log.gz` every minute) and the checkout gets `git reset --hard`.
- `pg_dump -Fc` is already compressed, so no `gzip` (unlike the log snapshots).
- Failure exits nonzero. Decide the **alert channel**: cron `MAILTO`, a healthcheck ping
  (e.g. a dead-man's-switch URL), or a line the existing `/api/logs` surface can read.

### B2. Cron install (mirrors the poller install comment)

```cron
# Daily DB backup at 03:30 (low traffic). Output + state in $HOME/shuttlementor-backups/.
30 3 * * * /home/<user>/Desktop/projects/shuttleMentor/scripts/backup-db.sh >> $HOME/shuttlementor-backups/backup.log 2>&1
```

(Confirm the real `REPO_DIR` on `neerumalla`; the poller header shows
`$HOME/Desktop/projects/shuttleMentor`.)

### B3. Restore test (do monthly — an untested backup is not a backup)

```bash
# Spin a throwaway PG, restore the latest dump, sanity-check, tear down.
LATEST=$(ls -t "$HOME/shuttlementor-backups/"*.dump | head -1)

docker run -d --name pg-restore-test -e POSTGRES_PASSWORD=test postgres:15-alpine
# wait for readiness
until docker exec pg-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

docker exec pg-restore-test createdb -U postgres restore_check
docker cp "$LATEST" pg-restore-test:/tmp/d.dump
docker exec pg-restore-test pg_restore -U postgres -d restore_check /tmp/d.dump

# Spot-check a few row counts against prod (adjust table names):
docker exec pg-restore-test psql -U postgres -d restore_check -c '\dt'
docker exec pg-restore-test psql -U postgres -d restore_check -c 'SELECT count(*) FROM "User";'

docker rm -f pg-restore-test
```

---

## C. Patch updates (Stage 3) — make 15.x security fixes land

`docker compose up` reuses the cached `db` image, so a floating `15-alpine` tag can sit on a
months-old patch. Re-pull deliberately on a cadence:

```bash
# Prod — pull the latest 15-alpine and recreate ONLY the db (data volume persists).
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull db
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d db
docker exec shuttlementor-db-prod psql -U postgres -d shuttlementor -c 'SELECT version();'
```

This is **only safe for patch (same-major) updates** — the data format is unchanged. Never
point this at a new major (see §E). Cadence: quarterly or on CVE notice. Could be cron'd, but
because it recreates the db container, prefer a low-traffic window.

**Lazy alternative:** add `pull_policy: always` to the `db` service so every redeploy re-pulls.
Trade-off: each redeploy then depends on the registry being reachable.

---

## D. Off-box backups (Stage 3)

A dump that only lives on `neerumalla` dies with the box. After §B works, ship a copy off-host.
Options to evaluate (no decision yet):
- `rclone`/`aws s3 cp` the nightly dump to object storage (append to `backup-db.sh` or a sidecar).
- `scp`/`rsync` to a second host.
- Encrypt at rest if the destination isn't trusted (`age`/`gpg`).

Keep the same retention discipline at the destination (lifecycle policy or a mirror of the `find -mtime` sweep).

---

## E. Major-version upgrade runbook (Stage 4–5)

**Method: dump → restore into a fresh volume on the target major.** Not `pg_upgrade`: the alpine
image ships only one major-version binary, and in-place `pg_upgrade` needs both old and new
binaries present. Dump/restore can jump multiple majors at once (15 → 18 is one hop).

**Pre-req:** §B backups working and a restore test passed. Schedule a low-traffic window;
watch RAM on the tight box during restore + index build.

Let `N` = target major (decide 17 vs 18 in the plan).

### E1. Pause the auto-deploy poller

The poller hard-resets to `origin/main` every minute and would (a) revert any server-local
compose edits and (b) auto-apply a half-finished change. Pause it first:

```bash
# Comment the poller line, then confirm no deploy is mid-flight.
crontab -l | sed 's#^\([^#].*poll-main-redeploy\)#\#\1#' | crontab -
crontab -l | grep poll-main-redeploy        # verify it's commented
pgrep -fa poll-main-redeploy || echo "no poller running"
```

### E2. Fresh backup + verify (§B)

```bash
scripts/backup-db.sh
# then run the §B3 restore test against this exact dump before proceeding.
DUMP=$(ls -t "$HOME/shuttlementor-backups/"*.dump | head -1)
```

### E3. Restore into a NEW volume (old volume untouched = physical rollback)

```bash
NEWVOL="shuttlementor-prod-postgres-data-pg${N}"
docker volume create "$NEWVOL"

# Temp target on the new major, isolated (not the prod stack).
docker run -d --name pg-upgrade-target \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="${DB_PASSWORD:?set DB_PASSWORD}" \
  -e POSTGRES_DB=shuttlementor \
  -v "$NEWVOL":/var/lib/postgresql/data \
  postgres:${N}-alpine
until docker exec pg-upgrade-target pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

# Restore the custom-format dump (newer server restoring an older dump is supported).
docker cp "$DUMP" pg-upgrade-target:/tmp/prod.dump
docker exec pg-upgrade-target pg_restore -U postgres -d shuttlementor --no-owner /tmp/prod.dump
docker exec pg-upgrade-target psql -U postgres -d shuttlementor -c 'ANALYZE;'

# Verify before cutover (compare to prod counts captured beforehand).
docker exec pg-upgrade-target psql -U postgres -d shuttlementor -c '\dt'
docker exec pg-upgrade-target psql -U postgres -d shuttlementor -c 'SELECT version();'

docker stop pg-upgrade-target && docker rm pg-upgrade-target
```

### E4. Cut over via a committed change (not a server-local edit)

Because the poller owns `origin/main`, make the switch a commit so it deploys cleanly:

1. Edit `docker-compose.yml:54` → `postgres:${N}-alpine`.
2. Repoint the prod volume to `$NEWVOL` in `docker-compose.prod.yml` (the `volumes:` block, name `shuttlementor-prod-postgres-data-pg${N}`).
3. Update `package.json` `docker:volumes:ensure:prod` (and the prune-script labels if they pin the old name) to the new volume name.
4. Commit (reference the plan stage in the message), push to `main`.

Then on the box, **with the poller still paused**, deploy once manually and smoke-test:

```bash
git fetch origin main && git reset --hard origin/main
npm run docker:prod:redeploy:detached
curl -fs https://www.facilitypresence.com/api/health
```

### E5. Resume the poller

```bash
crontab -l | sed 's#^#\#&#; s#^\#\(.*poll-main-redeploy\)#\1#' | crontab -   # re-review by hand; safest is `crontab -e`
crontab -l | grep poll-main-redeploy
```
(Honestly: just `crontab -e` and uncomment the line — less clever, less risk.)

### E6. Hold rollback, then prune

- Keep the old `shuttlementor-prod-postgres-data` volume **~1 week**.
- **Rollback** if needed: revert the cutover commit (restores old image + old volume name); the
  old data volume is intact, so it's a redeploy, not a restore.
- After the soak: `docker volume rm shuttlementor-prod-postgres-data` (old) and update the
  ensure/prune scripts to drop the stale reference.

---

## F. Verification checklist (post-patch and post-upgrade)

- [ ] `SELECT version();` shows the intended version.
- [ ] Row counts on key tables match the pre-change snapshot (`User`, `Club`, invoices, etc.).
- [ ] `prisma migrate deploy` reports no pending migrations (entrypoint runs it on boot).
- [ ] `/api/health` green via Caddy (`https://www.facilitypresence.com/api/health`).
- [ ] App smoke test: login, calendar load, a check-in, an invoice read.
- [ ] Backup job still succeeds against the new version (re-run `backup-db.sh`).
- [ ] (Upgrade only) old volume retained; calendar reminder set to prune after soak.

---

## G. Cross-references

- Staged backlog & priorities: `postgres-maintenance-plan.md`
- Compose / version source of truth: `docker-compose.yml:54`
- Deploy poller (auto-deploy behavior to pause): `scripts/poll-main-redeploy.sh`
- Existing script idioms to mirror: `scripts/snapshot-logs.sh`
