# Postgres Version & Maintenance Plan

**Created:** 2026-05-27
**Status:** Draft — staged backlog, ordered smallest → largest effort. Revisit to deepen each stage.
**Owner:** infra
**Companion:** `postgres-runbooks.md` — concrete drafts (scripts, cron, command-by-command runbooks) for the stages below. Nothing in either doc is implemented yet.

## Purpose

Capture the highest-value, lowest-effort actions for keeping Postgres current and
recoverable, staged so we can pick up the cheap wins now and revisit the heavier
items later. This is a living backlog, not a finished runbook — each stage has a
"Revisit later" note for where to go deeper.

## How to read this doc

- **Effort:** XS (minutes) · S (an hour or two) · M (half-day) · L (a day+) · XL (project)
- **Priority:** P0 (do first / unblocks everything) · P1 (high) · P2 (should) · P3 (nice-to-have)
- Stages are ordered by **effort ascending**. Priority is called out per item so value
  is visible independent of effort. **If you do only one thing, do Stage 2 (backups).**

---

## TL;DR priority list

| # | Action | Stage | Effort | Priority |
|---|--------|-------|--------|----------|
| 1 | Automated `pg_dump` backups + retention + restore test | 2 | S | **P0** |
| 2 | Pin `start-database.sh` to `postgres:15-alpine` (kill version drift) | 1 | XS | P1 |
| 3 | Decide & document patch-tag policy (exact pin vs floating + pull) | 1 | XS | P1 |
| 4 | Make minor/patch updates actually land (periodic `pull` of db image) | 3 | S | P1 |
| 5 | Ship a backup copy off the prod box | 3 | M | P1 |
| 6 | Write the major-version upgrade runbook (dump/restore) | 4 | M | P1 |
| 7 | Guard auto-deploy against accidental db image-tag bumps | 4 | M | P2 |
| 8 | Execute first major upgrade (15 → 17/18) | 5 | L | P2 |
| 9 | Strategic: managed PG / auto-upgrade tooling / staging rehearsal | 6 | L–XL | P3 |

---

## Current state snapshot

| Concern | Today |
|---|---|
| Pinned version | `postgres:15-alpine` — single source of truth in `docker-compose.yml:54`; dev/prod inherit it (no override). |
| Bare-metal local script | `start-database.sh:83` pulls **unpinned** `docker.io/postgres` (= `latest`). Drift risk. |
| Data storage | External named volumes `shuttlementor-{dev,prod}-postgres-data` at `/var/lib/postgresql/data`. Survives `compose down` + redeploys. |
| Backups | **None.** No `pg_dump`/`pg_restore`/`pg_upgrade` anywhere in the repo. |
| Migrations | `docker-entrypoint.sh` runs `prisma migrate deploy`; prod fails hard (no auto-resolve). |
| Deploy trigger | `scripts/poll-main-redeploy.sh` hard-resets to `origin/main` every minute and redeploys. **Any committed image-tag change auto-applies in ~60s.** |
| Schema portability | Vanilla — no extensions; only `gen_random_uuid()` (core since PG 13). App is portable across PG 13–18; the only blocker to a major upgrade is the on-disk data format. |
| Host | `neerumalla` prod box: 4 cores / 7.6 GiB, tight RAM + disk. Heavy restores need a low-traffic window. |

### Two kinds of "update" (the mental model)

1. **Minor / patch** (15.4 → 15.8): security fixes, **same on-disk format** → drop-in. Today these do **not** land reliably because redeploy only rebuilds the *app*; the cached db image can sit on an old 15.x for months. Fixed in Stage 3.
2. **Major** (15 → 16/17/18): **on-disk format changes**. A naive tag bump crash-loops the db (`database files are incompatible with server`), the 180s health probe times out, and **there is no rollback** → prod outage. Requires dump/restore (Stage 4–5).

---

## Stage 1 — Config hygiene (Effort: XS)

Near-zero-effort cleanups that remove footguns. No data touched.

| Action | Effort | Priority | Why |
|--------|--------|----------|-----|
| Pin `start-database.sh:83` `docker.io/postgres` → `postgres:15-alpine` | XS | P1 | Bare-metal local dev currently silently runs PG 17/18 against a 15-shaped app. |
| Decide patch-tag policy and write it down here | XS | P1 | Either pin exact (`postgres:15.8-alpine`, deliberate bumps) or keep floating `15-alpine` + a pull cadence (Stage 3). Pick one on purpose. |
| Confirm dev/prod have no stray image override | XS | P2 | Verified today (none) — keep it that way so the single pin stays authoritative. |

**Concrete draft:** `postgres-runbooks.md` §A (exact `start-database.sh` diff + patch-tag options).

**Revisit later:** add a CI/lint check that fails if any compose/script references an unpinned `postgres` tag.

---

## Stage 2 — Safety net: backups (Effort: S) — **START HERE (P0)**

The single highest-value gap. Nothing else here is safe without it, and it's a
prerequisite for every major upgrade. Model it on the existing
`scripts/snapshot-logs.sh` + poller conventions.

| Action | Effort | Priority | Why |
|--------|--------|----------|-----|
| `pg_dump -Fc` backup script for prod db | S | **P0** | One command: `docker exec shuttlementor-db-prod pg_dump -U postgres -Fc shuttlementor > backups/<ts>.dump`. Custom format = compressed + selective restore. |
| Cron the backup (mirror poller install pattern) | S | **P0** | Daily (or more) tick; keep state/output out of the git checkout so `git reset --hard` can't wipe it (same approach as `~/.shuttlementor-main-poll/`). |
| Retention sweep | S | P1 | Mirror the poller's 14-day `find ... -mtime +N -delete` sweep. **Do not** put dumps in `logs/` — the poller already prunes `logs/*.log.gz`. Use a dedicated `backups/` dir (gitignored). |
| **Restore test** | S | P1 | A backup you've never restored isn't a backup. Restore the latest dump into a throwaway container and diff row counts. Schedule this monthly. |

**Concrete draft:** `postgres-runbooks.md` §B (full `backup-db.sh`, cron line, restore test).

**Revisit later:** off-box copy is its own item (Stage 3, #5) — a dump sitting only on `neerumalla` dies with the box. Also consider WAL archiving / point-in-time recovery once daily dumps feel too coarse.

---

## Stage 3 — Make patch updates land + durability (Effort: S–M)

Close the "patches silently don't apply" gap and get a backup off the box.

| Action | Effort | Priority | Why |
|--------|--------|----------|-----|
| Periodically re-pull the db image | S | P1 | `docker compose ... pull db && up -d db` on a cadence (e.g. monthly cron or pre-deploy step). Picks up 15.x security patches. **Alternative:** set `pull_policy: always` on the `db` service — lazier, but every redeploy then hits the registry. |
| Ship backups off-box | M | P1 | Copy nightly dumps to object storage / another host. `neerumalla` is a single box with tight disk; a local-only backup doesn't survive disk loss. |
| Document the patch cadence here | XS | P2 | "Patch quarterly or on CVE notice." Make it a checklist item, not tribal knowledge. |

**Concrete draft:** `postgres-runbooks.md` §C (patch-pull commands) and §D (off-box options).

**Revisit later:** alerting when the running server version (`SELECT version();`) drifts from the intended pin, and when a backup job fails.

---

## Stage 4 — Major-upgrade readiness (Effort: M)

Write the playbook and remove the auto-deploy footgun **before** attempting a major bump.

| Action | Effort | Priority | Why |
|--------|--------|----------|-----|
| Write the dump/restore upgrade runbook | M | P1 | See draft procedure below. Dump/restore (not `pg_upgrade`) because the alpine image ships only one major-version binary, so in-place `pg_upgrade` (needs both old+new binaries) is awkward here. |
| Guard auto-deploy against image-tag changes | M | P2 | The poller auto-applies any committed change in ~60s. A db tag bump must never reach prod via the normal flow. Options: a pre-deploy check that aborts if the db image major changed, or a documented "pause the poller first" gate. |

### Draft major-upgrade procedure (15 → target)

1. **Pause the poller** (`poll-main-redeploy.sh`) — otherwise it fights manual steps / auto-applies a half-finished change.
2. **Backup + verify** (Stage 2): `pg_dump -Fc` (or `pg_dumpall`), confirm the dump restores cleanly into a scratch container.
3. **New volume, keep the old:** create a fresh named volume; leave `shuttlementor-prod-postgres-data` untouched as the rollback.
4. **Start target version** (`postgres:<N>-alpine`) on the new volume (fresh init), **restore** the dump, run `ANALYZE`.
5. **Smoke test** via `/api/health` + key flows. Watch RAM during restore/index rebuild (heaviest moment on the tight box).
6. **Cut over:** point the compose volume name + image tag at the new setup, commit, **resume the poller** to redeploy.
7. **Hold the old 15 volume** for ~1 week before pruning.

**Concrete draft:** `postgres-runbooks.md` §E — full command-by-command runbook (pause poller → backup → restore into new volume → committed cutover → resume poller) plus rollback (§E6).

**Revisit later:** turn this into a scripted, mostly-automated runbook with timing checkpoints (like the phased timing in `poll-main-redeploy.sh`).

---

## Stage 5 — Execute first major upgrade (Effort: L)

| Action | Effort | Priority | Why |
|--------|--------|----------|-----|
| Run the runbook for real: 15 → 17 or 18 | L | P2 | Not urgent — PG 15 is supported until ~Nov 2027 — but we're already two majors behind current. Dump/restore can jump multiple majors at once. |
| Decide target version (17 = N-1 conservative, 18 = current) | XS | P2 | Record the decision + date here. |
| Post-upgrade verification checklist | S | P1 | Row counts, key queries, app smoke test, backup job still green against new version. |

**Concrete draft:** `postgres-runbooks.md` §E (procedure) + §F (post-upgrade verification checklist).

**Revisit later:** rehearse on a clone first (Stage 6) before touching prod.

---

## Stage 6 — Strategic / revisit-later (Effort: L–XL)

Bigger bets to evaluate once the basics above are in place.

| Action | Effort | Priority | Why |
|--------|--------|----------|-----|
| Staging/clone environment for upgrade rehearsal | L | P3 | Practice major upgrades against a copy of prod data before the real cutover. |
| Evaluate auto-upgrade tooling (e.g. `pgautoupgrade` image) | L | P3 | Runs `pg_upgrade` on start. Removes manual steps but adds a non-official dependency — assess trust/control trade-off. |
| Evaluate managed Postgres | XL | P3 | Offloads patching/upgrades/backups entirely. Cost + migration effort vs. the self-host control we have today. |
| Version + backup-health monitoring/alerting | M–L | P3 | Alert on version drift, backup failures, disk pressure on the db volume. |

---

## Open questions / to revisit

- Patch policy: exact-pin vs floating `15-alpine` + pull cadence — **decide in Stage 1.**
- Backup frequency & retention numbers — start daily / 14-day, tune later.
- Off-box backup destination — where? (object storage vs second host.)
- Target major version for the first upgrade — 17 or 18?
- Do we need PITR (WAL archiving), or are daily logical dumps enough for our RPO?

## Appendix — reference facts

- **Version source of truth:** `docker-compose.yml:54` (`postgres:15-alpine`).
- **Drift source:** `start-database.sh:83` (`docker.io/postgres`, unpinned).
- **Volumes:** `shuttlementor-dev-postgres-data`, `shuttlementor-prod-postgres-data` (external, named).
- **Prod db container:** `shuttlementor-db-prod`; user `postgres`; db `shuttlementor` (default).
- **Deploy poller:** `scripts/poll-main-redeploy.sh` (cron, 1-min, hard-reset to `origin/main`).
- **PG 15 EOL:** ~Nov 2027. Schema uses only `gen_random_uuid()` (core since PG 13); no extensions → app portable across PG 13–18.
