# pgBackRest — Local-Repo Setup Runbook (prod, neerumalla)

**Created:** 2026-05-29
**Status:** 🚧 PROPOSED — copy-paste runbook to execute on `neerumalla`. Local repo only
(no off-box/R2 yet — that's a later step). Companion to `postgres-maintenance-plan.md`
(Stage 2) and `postgres-runbooks.md`.
**Goal:** continuous WAL archiving + full/diff backups + point-in-time recovery (PITR),
all to a **local** repo on the prod box. This is the foundation under both the cloud-DR
and on-prem-HA plans.

## Why pgBackRest needs these specific moves (read first)

- **One Postgres restart** is required: `archive_mode` is not changeable at runtime.
  pgBackRest's online backup *requires* archiving. Restart in a low-traffic window.
- **pgbackrest must be baked into the db image**, not installed into the running
  container. The auto-deploy poller (`poll-main-redeploy.sh`) recreates the db container
  from the image every redeploy. If `archive_command` calls a pgbackrest that disappears,
  WAL accumulates and can fill the (tight) disk → write stall → outage. **Order matters:
  ship the image with pgbackrest, *then* enable archiving.**
- **Tight disk:** keep retention small (`repo1-retention-full=2`) and watch disk after enabling.

## Current facts (verified)

- Prod db container: `shuttlementor-db-prod`, image `postgres:15-alpine`, data volume
  `shuttlementor-prod-postgres-data` → `/var/lib/postgresql/data`, external port `5433`.
- DB user `postgres`, db `shuttlementor`. Postgres OS uid in alpine image = `70`.
- Compose: base `docker-compose.yml` + `docker-compose.prod.yml`.
- Poller hard-resets to `origin/main` every ~60s and redeploys → durable changes must be **committed**.

---

## Phase 1 — Bake pgbackrest into the prod db image (committed repo change)

### 1a. New file: `Dockerfile.db`

```dockerfile
# Prod Postgres image with pgBackRest baked in (so archive_command always finds the
# binary, surviving poller redeploys). Dev keeps stock postgres:15-alpine.
FROM postgres:15-alpine
RUN apk add --no-cache pgbackrest
# Ship a default config; pg1-path/stanza match the prod container.
COPY serverFiles/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
RUN mkdir -p /var/lib/pgbackrest /var/log/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /etc/pgbackrest
```

### 1b. New file: `serverFiles/pgbackrest.conf`

```ini
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=2
repo1-retention-diff=4
compress-type=zst
compress-level=3
process-max=2
log-level-console=info
log-level-file=detail
start-fast=y
# Local socket connection to the running cluster (default socket dir in the image).
[shuttlementor]
pg1-path=/var/lib/postgresql/data
pg1-socket-path=/var/run/postgresql
pg1-port=5432
```

### 1c. Edit `docker-compose.prod.yml` — build the db from `Dockerfile.db`, add repo volume

In the `db:` service block, add a `build` + `image` and mount a repo volume:

```yaml
  db:
    container_name: shuttlementor-db-prod
    build:
      context: .
      dockerfile: Dockerfile.db
    image: shuttlementor-db:15-pgbackrest
    ports:
      - "5433:5432"
    volumes:
      - postgres_data_prod:/var/lib/postgresql/data
      - pgbackrest_repo_prod:/var/lib/pgbackrest      # <-- new local repo
```

And in the `volumes:` block at the bottom, add the repo volume (external, like the data volume):

```yaml
volumes:
  postgres_data_prod:
    name: shuttlementor-prod-postgres-data
    external: true
  pgbackrest_repo_prod:                                # <-- new
    name: shuttlementor-prod-pgbackrest-repo
    external: true
```

### 1d. Pre-create the repo volume + deploy

On the box (the poller will also create-if-missing, but make it explicit):

```bash
docker volume create shuttlementor-prod-pgbackrest-repo
```

Then **commit + push** these three changes (Dockerfile.db, serverFiles/pgbackrest.conf,
docker-compose.prod.yml). The poller redeploys within ~60s and **rebuilds the db image
with pgbackrest** (archiving still OFF — safe). Confirm:

```bash
docker exec shuttlementor-db-prod pgbackrest version     # prints pgBackRest x.xx
docker exec shuttlementor-db-prod ls -ld /var/lib/pgbackrest
```

---

## Phase 2 — Create the stanza + enable archiving (one restart)

### 2a. Fix repo ownership (volume mount can land root-owned) + create stanza

```bash
docker exec -u root shuttlementor-db-prod chown -R postgres:postgres /var/lib/pgbackrest
docker exec -u postgres shuttlementor-db-prod pgbackrest --stanza=shuttlementor stanza-create
```

### 2b. Turn on archiving (persisted in PGDATA via ALTER SYSTEM — survives redeploys)

```bash
docker exec -u postgres shuttlementor-db-prod psql -U postgres -d shuttlementor -c \
  "ALTER SYSTEM SET archive_mode = 'on';"
docker exec -u postgres shuttlementor-db-prod psql -U postgres -d shuttlementor -c \
  "ALTER SYSTEM SET archive_command = 'pgbackrest --stanza=shuttlementor archive-push %p';"
```

### 2c. Restart Postgres (low-traffic window — archive_mode change needs it)

```bash
docker restart shuttlementor-db-prod
# wait for health, then confirm archiving + stanza wiring:
until docker exec shuttlementor-db-prod pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec -u postgres shuttlementor-db-prod psql -U postgres -c "SHOW archive_mode;"   # on
docker exec -u postgres shuttlementor-db-prod pgbackrest --stanza=shuttlementor check    # PASS
```

`check` forces a WAL switch and verifies archive-push lands in the repo. If it fails, fix
before proceeding (do NOT leave archiving half-broken — that's the disk-fill risk).

---

## Phase 3 — First backup

```bash
docker exec -u postgres shuttlementor-db-prod pgbackrest --stanza=shuttlementor --type=full backup
docker exec -u postgres shuttlementor-db-prod pgbackrest --stanza=shuttlementor info
```

`info` should show one full backup and a WAL archive range. That's your first recoverable point.

---

## Phase 4 — Restore test (the proof — an untested backup is not a backup)

Restores the latest backup into a throwaway cluster and checks row counts. Uses the
pgbackrest-enabled image so recovery's `restore_command` can pull WAL from the repo.

```bash
# scratch data volume, owned by the alpine postgres uid (70)
docker volume create pgbackrest-restore-test
docker run --rm -v pgbackrest-restore-test:/d alpine chown 70:70 /d

# restore latest into the scratch volume (repo mounted read-only)
docker run --rm -u postgres \
  -v shuttlementor-prod-pgbackrest-repo:/var/lib/pgbackrest:ro \
  -v pgbackrest-restore-test:/var/lib/postgresql/data \
  --entrypoint pgbackrest shuttlementor-db:15-pgbackrest \
  --stanza=shuttlementor --pg1-path=/var/lib/postgresql/data restore

# boot a throwaway PG on the restored data (custom image so restore_command works)
docker run -d --name pg-restore-test \
  -v shuttlementor-prod-pgbackrest-repo:/var/lib/pgbackrest:ro \
  -v pgbackrest-restore-test:/var/lib/postgresql/data \
  shuttlementor-db:15-pgbackrest
until docker exec pg-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

# sanity checks — compare to prod
docker exec pg-restore-test psql -U postgres -d shuttlementor -c '\dt'
docker exec pg-restore-test psql -U postgres -d shuttlementor -c 'SELECT count(*) FROM "User";'
docker exec shuttlementor-db-prod  psql -U postgres -d shuttlementor -c 'SELECT count(*) FROM "User";'

# tear down
docker rm -f pg-restore-test
docker volume rm pgbackrest-restore-test
```

Row counts match prod → backups are real. Schedule this test monthly.

---

## Phase 5 — Schedule backups + retention (cron)

Mirror the poller's install idioms (state/log outside the checkout, `flock`, minimal PATH).
Weekly full + daily diff is a sane starting cadence.

`scripts/pgbackrest-backup.sh` (draft):

```bash
#!/usr/bin/env bash
# Local pgBackRest backup driver. type=full on Sundays, type=diff otherwise.
# Exits nonzero on failure so cron MAILTO/monitoring notices.
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
LOGDIR="$HOME/shuttlementor-pgbackrest"; mkdir -p "$LOGDIR"
exec 9>"$LOGDIR/.lock"; flock -n 9 || { echo "$(date -Iseconds) busy; skip"; exit 0; }
docker ps --format '{{.Names}}' | grep -qx shuttlementor-db-prod || {
  echo "$(date -Iseconds) ERROR: db not running"; exit 1; }
TYPE=full; [ "$(date +%u)" -ne 7 ] && TYPE=diff   # Sun=7 → full, else diff
docker exec -u postgres shuttlementor-db-prod \
  pgbackrest --stanza=shuttlementor --type="$TYPE" backup
echo "$(date -Iseconds) ok: $TYPE backup"
```

Cron (low-traffic hour; retention is enforced automatically by `repo1-retention-*`):

```cron
30 3 * * * /home/<user>/<repo>/scripts/pgbackrest-backup.sh >> $HOME/shuttlementor-pgbackrest/backup.log 2>&1
```

(Confirm the real repo path on the box — poller header shows `$HOME/Desktop/projects/shuttleMentor`.)
Commit `scripts/pgbackrest-backup.sh` so it survives the poller's `git reset --hard`.

---

## Verification checklist

- [ ] `pgbackrest version` runs inside `shuttlementor-db-prod` (image baked correctly).
- [ ] `pgbackrest --stanza=shuttlementor check` → PASS.
- [ ] `SHOW archive_mode;` → `on`; `archive_command` set.
- [ ] `pgbackrest info` shows a full backup + WAL range.
- [ ] Restore test row counts match prod.
- [ ] Disk after a full backup is comfortably within headroom (`docker system df`, `df -h`).
- [ ] Cron line installed; first scheduled run logged green.

## Rollback / disable (if needed)

```bash
docker exec -u postgres shuttlementor-db-prod psql -U postgres -c "ALTER SYSTEM SET archive_mode='off';"
docker restart shuttlementor-db-prod         # archiving off; backups stop, no disk-fill risk
```
Revert the Phase-1 commit to drop back to the stock db image.

## Later (deferred, explicitly out of scope today)

- **Off-box copy to Cloudflare R2**: add a `[global] repo2-*` S3 block (R2 endpoint) so
  pgBackRest writes to *both* local and R2 — turns this into real offsite DR. Free egress.
- **Feed the cloud warm standby** from the R2 repo (see `hybrid-cloud/cloud-dr-findings.md`).
- **PITR drill**: practice `--type=time` restore to a specific timestamp.
```
