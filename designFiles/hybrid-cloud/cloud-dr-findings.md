# Hybrid Cloud / DR — Discussion Findings

**Created:** 2026-05-29
**Status:** Exploration / decision notes — nothing implemented yet.
**Owner:** infra
**Context companions:** `postgres-maintenance-plan.md`, `postgres-runbooks.md` (backups/upgrades), `infrastructure.md` memory (current single-box setup).

## Purpose

Capture the findings from the architecture discussion on growing the on-prem setup
and adding a cloud disaster-recovery (DR) target. This is a decisions/trade-offs log,
not a runbook. The current leaning is recorded under "Decision so far."

---

## Current state (starting point)

- Single home server (`neerumalla`, 4c / 7.6 GiB, tight RAM) in the basement.
- 2 containers per env (dev + prod): Next.js app + Postgres, via Docker Compose.
- Caddy reverse proxy; cron-driven auto-deploy (`poll-main-redeploy.sh`) hard-resets to `origin/main` every minute.
- Named Postgres volumes per env. **No backups, no HA, no DR today.**
- DNS: ddclient updating the home dynamic IP (was broken, **fixed as of 2026-05-29**).

Plan was to add several low-power Dell micro PCs in the same basement network.

---

## Decision so far (current leaning)

> **Keep a single warmed-up instance on Hetzner as the DR target, and push backups/WAL to Cloudflare R2.**

Rationale: cheapest robust option. Hetzner VM is ~3–6× cheaper than EC2 for equivalent
specs; R2 has free egress so restores/WAL pulls over the home uplink cost nothing.
On-prem stays primary; cloud is a deliberate, manually-promoted DR target (not auto-failover).

Still to decide: exact instance size, whether to also run a pre-warmed *app* instance
(Fly.io vs same Hetzner box), RTO/RPO targets, and the promotion/failback runbook.

---

## Recommended architecture (object-store-buffered warm standby)

```
on-prem primary ──(continuous WAL push, pgBackRest)──▶ Cloudflare R2 (S3-compatible)
                                                              │
cloud warm standby (self-managed PG on Hetzner) ──(restore base + replay WAL)──┘
pre-warmed app instance ──▶ points at on-prem now; flips to cloud standby on failover
DNS health-check failover (Route 53 or Cloudflare) for the app front door only
```

**Why object-store buffering beats live streaming replication for a home setup:**
no fragile low-latency link from cloud back to the house. The object store absorbs
the flakiness of a residential uplink; on-prem only has to *push* when it can. Same
pgBackRest repo doubles as the "house fire" offsite backup **and** the DR feed, and
gives point-in-time recovery for free.

**Failover (manual, deliberate):** promote cloud standby → point pre-warmed app at it
→ flip DNS. Failback: rebuild on-prem from the repo, re-sync, cut back.

---

## Key technical findings & forks

### 1. "Managed Postgres" and "on-prem stays primary" don't mix
Managed Postgres (RDS, Cloud SQL, DO Managed) is a black box — no `archive_command`/
`restore_command`, no pgBackRest, can't follow an external self-hosted primary via
physical replication. Three coherent models:

| Model | DR replica works how? | Trade-off |
|---|---|---|
| **A. On-prem primary + self-managed cloud standby** | Streaming, or WAL shipping via pgBackRest | You operate the cloud PG, but true fast-promote hot standby. **← chosen direction** |
| **B. On-prem primary + *managed* cloud replica** | Logical replication only | Managed ops, but DDL/sequences/large-objects don't replicate cleanly; messy failback |
| **C. Managed cloud PG *is* primary** | On-prem app connects out | Simplest DR, but kills on-prem-primary benefit; paying for managed full-time |

**DO-specific confirmation:** DO *Managed* Postgres **cannot** be kept warm from DO Spaces —
it keeps its own internal backups in DO's storage, not your bucket. Only a **self-managed**
Postgres on a droplet can use Spaces/R2 as a pgBackRest repo. (True of every provider:
"managed" + "warm standby fed from my bucket" don't combine.)

### 2. DNS failover is for the app tier, not the data tier
Route 53 health-check failover is ~30–90s detection + TTL + client/resolver caching →
real-world failover is *minutes*. Fine for the app front door. **Database primary
election must be Patroni/HAProxy or manual promotion — never DNS.** Also: Route 53
checkers are public AWS IPs and can't probe a private basement address, so on-prem must
be publicly reachable on a stable IP (the now-fixed ddclient dependency).

### 3. Patroni requires a DCS (etcd/Consul) — placement decides failover behavior
Not yet needed at the chosen scale, but recorded for the later on-prem-HA phase:
a Patroni cluster needs a consensus store, and **where its quorum lives** determines
partition behavior. A cluster *stretched across the WAN* turns a home-internet hiccup
into a partition (split-brain / bad auto-failover risk). If/when on-prem HA is built,
keep etcd quorum **entirely on-prem**.

### 4. Most-likely failures are upstream of in-basement HA
Clustering Dell boxes only protects against one box's hardware dying. The likelier
outages — ISP, home power, dynamic-IP rotation — are unaddressed by basement
redundancy. This is why cloud DR (independent site) matters more than multi-box on-prem,
and why the highest-ROI item is **offsite backups + a tested restore**, regardless of
everything else.

### 5. MTBF note
Wiring required components in series *lowers* MTBF. A complex hybrid stack can have
worse availability than the single box in year one because the failover machinery
itself becomes a failure source. Favor deliberate/manual failover over fragile
auto-failover across the home link.

---

## Options explored and set aside

- **Edge nodes hosted at customer clubs (k8s):** rejected as a cost strategy. You don't
  control club networks (NAT, dynamic IP, captive portals); k8s hates the WAN (etcd
  latency, node churn); and putting all-customer data on a box inside one customer's
  building is a security/PCI non-starter (relevant given the payments-ISO direction).
  The salvageable idea is a *different* feature: an offline-resilient check-in/kiosk
  appliance (local cache, central source of truth) — not a money-saving hosting topology.
- **Docker Swarm:** works, but effectively in maintenance mode (no real development).
  For new infra, the honest fork is **k3s** (if orchestration is wanted) or **plain
  Docker Compose + systemd** (simple). Not chosen — current scale doesn't need an
  orchestrator yet.
- **Proxmox:** only worth it for VM + mixed-workload needs. User confirmed **no VMs
  needed** (CI runners etc. can run directly on hosts), so the hypervisor overhead
  isn't justified.
- **Cloudflare for compute:** no traditional always-on VM. Workers (isolates, not
  containers), Containers (Worker-orchestrated, young), no Postgres host. **Use
  Cloudflare for R2 + DNS only**, not for app/DB compute.

---

## Provider notes

### Object storage (pgBackRest repo)
- **Cloudflare R2 — chosen.** Free egress → DR restores and WAL pulls to the basement cost nothing.
- **S3** — free transfer only *in-region to EC2*; egress to home is ~$0.09/GB. Good if the whole DR lives in one AWS region.

### Compute cost comparison (approx US, on-demand, monthly; ballpark)

| Spec | Hetzner | DigitalOcean | EC2 (on-demand) |
|---|---|---|---|
| ~2 vCPU / 4 GB (app) | ~$9 (CPX21) | ~$24 | ~$33 (t3.medium) |
| ~4 vCPU / 8 GB (DB standby) | ~$8–15 (CX32) | ~$48 | ~$127 (c5.xlarge) |
| **Full DR pair / mo** | **~$16–24** | **~$60–72** | **~$150–160** (~$75–90 reserved) |

- Hetzner ~3–6× cheaper than EC2; ~2–3× cheaper than DO. Bundles generous SSD + 20TB traffic. Now has US regions.
- DO = predictable bundled middle (no transfer-math surprises).
- EC2 premium buys ecosystem (Route 53, free in-region S3 transfer, IAM) — only worth it if DR lives entirely in-region + committed Savings Plan.
- The line item that actually moves the bill is **how much always-on compute is kept warm**, not S3/storage (a couple $/mo either way).

### App tier (if a pre-warmed app instance is run separately)
- **Fly.io** — good fit: `min_machines_running=1` keeps a warm instance; anycast; fast stop/start.
- **Build once, deploy anywhere:** CI builds one image → on-prem pulls it (Swarm/compose) *and* `fly deploy --image <same image>` (or push to `registry.fly.io`). Fly doesn't force its build system.
- **DB on Fly: avoid** — per-machine local volumes make replication/backup your problem; a plain VM is simpler.

---

## Open questions / next steps

- [ ] **RTO/RPO target?** "Minutes of downtime + ~30s data loss OK" → pgBackRest pattern is ideal/cheap. "Zero loss, instant" → sync streaming + auto-failover (pricier, more fragile).
- [ ] Pick Hetzner instance size for the standby (CX32 4/8 likely).
- [ ] Run the pre-warmed app on the same Hetzner box, or separately on Fly?
- [ ] Write the concrete pgBackRest config (on-prem `archive_command` → R2) + standby `restore_command`.
- [ ] Write the manual promotion + failback runbook.
- [ ] CI flow: one build → push to registry → (a) on-prem deploy + (b) warm cloud app deploy.
- [ ] Phasing: do offsite backups (pgBackRest → R2 + tested restore) **first** — highest ROI, independent of the rest.
</content>
</invoke>
