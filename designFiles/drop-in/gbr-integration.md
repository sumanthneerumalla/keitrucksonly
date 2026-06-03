# Drop-In — GBR Integration Contract

How FP links members to GBR, submits self-reported match results for TrueSkill scoring, and reads global rankings. This is the first concrete stitch between the two products — see memory `project_fp_gbr_stitching` and [README.md](./README.md).

**Scope:** identity sync, the edge-function contract (with a direct-Supabase fallback), the submission loop, and the embed/read boundary. GBR remains the **system of record for player identity and TrueSkill rating**; FP never recomputes ratings.

---

## What GBR already provides (no schema change)

Confirmed by code investigation (2026-06-02):

| GBR primitive | Path / shape | Use |
| :--- | :--- | :--- |
| `external_player_identities` | `(player_id, source, external_id, external_name)`, `UNIQUE(source, external_id)`, **service-role "can manage" RLS** | The identity-link backbone |
| Ghost players | `players.user_id` nullable + `is_ghost`, `ghost_source`, `claim_status` | Provision a GBR player without forcing signup |
| Claim flow | edge fns `claim-ghost-account` / `unlink-ghost-account` | Player later merges the ghost into their real GBR account |
| Match import | `matches.external_match_id` (idempotent), `is_imported`, `submitted_by`, `match_weight` | Submit FP results idempotently |
| Teams | `teams (player1_id, player2_id, team_type: singles/doubles/mixed_doubles)` | Singles & doubles both native |
| Rating engine | `supabase/functions/calculate-ratings` — POST `{ match_id }`, invoked (service-role internally) for a confirmed match | TrueSkill (mu/sigma) update |
| Weights | tournament/imported **2.0×**, league **1.5×**, self-reported **1.0×**, walkover **0×** | Drop-in uses **1.0×** |

---

## Authentication & data flow (end-to-end)

**Golden rules:**
1. The player's **browser never talks to GBR directly** — every GBR write is proxied through FP's backend (a tRPC mutation → server-side `fetch`).
2. The **FP↔GBR shared secret and the anon key live only in FP's server env**, never shipped to the browser.
3. The **`service_role` never leaves Lovable Cloud** — it's injected into the GBR functions at runtime.

**Keys / credentials:**
| Credential | Authenticates | Lives in |
| :--- | :--- | :--- |
| Clerk session | Player → FP | Browser cookie |
| GBR **anon key** | Public/publishable key (ships in every browser; already in GBR's `.env` + `src/integrations/supabase/client.ts`). Only needed for direct PostgREST ranking reads — **optional** if reads go through a `get-rankings` function | FP backend env |
| **`X-ShuttleMentor-Secret`** (shared) | **FP backend → GBR functions** (the real write-auth) | GBR function env var **and** FP backend env |
| `SUPABASE_SERVICE_ROLE_KEY` | GBR function → GBR Postgres (bypasses RLS) | GBR Lovable runtime only |

> Our functions run **`verify_jwt = false`**, so the Supabase **gateway** doesn't require a Supabase JWT/anon key to reach them — exactly like GBR's Stripe webhook. **This does NOT mean unauthenticated.** Stripe still proves itself: it signs the body with `STRIPE_WEBHOOK_SECRET` and sends a signature the function verifies in-handler. Our functions do the same with a **`SHUTTLEMENTOR_SHARED_SECRET`** — that shared secret is the real authentication boundary. The anon key is **not** required to call these functions; it's only used for direct PostgREST reads, and even those can be a `get-rankings` function instead.

**How the shared secret is checked (two options):**
- **(a) Bearer header** — FP sends `X-ShuttleMentor-Secret: <secret>`; the function compares it to `Deno.env.get('SHUTTLEMENTOR_SHARED_SECRET')`. Simplest; fine over HTTPS (the secret travels each call, like an API key).
- **(b) HMAC signature — recommended, mirrors `STRIPE_WEBHOOK_SECRET`** — FP sends `X-ShuttleMentor-Signature: t=<ts>,v1=<hmac>` where `hmac = HMAC_SHA256(secret, ts + "." + rawBody)`; the function recomputes and compares, rejecting stale timestamps. The secret **never travels the wire** and replays are blocked. GBR already implements this pattern for `STRIPE_WEBHOOK_SECRET` / `RESEND_WEBHOOK_SECRET`, so there's a working template to copy.

Either way, `SHUTTLEMENTOR_SHARED_SECRET` is added to GBR's **Saved Secrets** (the same manager that holds `STRIPE_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET` — both manually added, no `[Lovable]` tag) and to FP's backend env. It's the only credential FP must hold, and you generate it yourself.

**Auth at each hop:**
| Hop | Direction | Auth mechanism |
| :--- | :--- | :--- |
| 1 | Browser → FP backend | Clerk session; FP verifies the user is a participant of the assignment |
| 2 | FP backend → GBR edge function | `X-ShuttleMentor-Secret` (validated in-handler). **No anon key needed** — `verify_jwt=false` makes the URL directly invocable, like the Stripe webhook |
| 3 | GBR function → GBR Postgres | injected `service_role` (bypasses RLS) |
| 4 | FP → GBR reads | **Either** anon key + public-SELECT RLS via PostgREST, **or** a `get-rankings` function (shared secret) to avoid the anon key entirely |

**Flow A — identity provisioning (lazy, on first check-in):**
`browser → FP dropIn.checkIn (Clerk)` → if no cached `gbrPlayerId`, `FP backend → POST sync-player-identity` (**secret only**, body `{source:'facilitypresence', externalId:<FP memberId>, name, gender, email?}`) → function validates secret → service-role resolves/creates ghost + link → returns `gbrPlayerId` → FP caches it on the profile + `DropInCheckIn`.

**Flow B — match result (on CONFIRMED):**
`browser → FP submitScore / confirmScore (Clerk; FP checks caller is a participant)` → when the assignment hits `CONFIRMED`, FP sets `gbrSyncStatus=PENDING` and a server worker `→ POST submit-match-result` (**secret only**, body keyed by `externalMatchId = assignmentId`) → function validates secret → service-role does idempotency check + create/reuse teams + insert match (`verification_status='confirmed'`, `match_weight=1.0`, `submitted_by=<FP service user>`) + invoke `calculate-ratings` → returns ratings → FP marks `SENT`.

**Flow C — rankings read:**
`FP → GET /rest/v1/players?select=...&id=eq.<gbrPlayerId>` with the **anon key** (public-SELECT RLS) — *or*, to avoid the anon key, a `get-rankings` edge function (shared secret). Renders the global-rank badge next to the FP drop-in leaderboard.

---

## 1. Identity sync

**Link key:** `external_player_identities` row with `source = 'facilitypresence'`, `external_id = <FP member id>` (a stable FP UUID). **Email is a dedup heuristic, never the key.**

**Bidirectional:** FP also caches `gbrPlayerId` on the member profile (and per-session on `DropInCheckIn.gbrPlayerId`) for fast reverse lookups and global-rank display.

**Coexistence:** tournament-software links use `source = 'tournament_software'`; because the unique constraint is on the `(source, external_id)` pair, a GBR player can hold both an FP link and a tournament-software link without conflict. **Do not** repurpose existing tournament-software rows.

**Provisioning is lazy** (DI-5): the first time an FP member checks into / registers for a drop-in, FP calls `sync-player-identity`. Resolution order inside GBR:

```
1. Look up external_player_identities by (source='facilitypresence', external_id=fpMemberId).
   → found: return its player_id.
2. Else, if email provided, look up an existing players row by email (dedup).
   → found: INSERT the facilitypresence link to that player; return player_id.
3. Else, INSERT a ghost player (user_id=null, is_ghost=true, ghost_source='facilitypresence',
   first_name/last_name/gender from FP) + the facilitypresence link; return player_id.
```

FP stores the returned `gbrPlayerId`. The player can later claim the ghost via GBR's existing claim flow.

---

## 2. Edge-function contract (preferred transport)

Build **2-3 GBR Supabase edge functions**, deployed via git (Lovable syncs them) and called from FP's Next backend. They use `SUPABASE_SERVICE_ROLE_KEY` (**injected by Lovable Cloud at runtime**) internally, so they sidestep the fact that `players`/`matches` have no service-role RLS exemption — and crucially, **FP never needs the service_role key itself** (Lovable Cloud doesn't expose it; see §3). Auth: FP authenticates with a shared **`SHUTTLEMENTOR_SHARED_SECRET`** (raw header, or — recommended — an HMAC signature mirroring `STRIPE_WEBHOOK_SECRET`); with `verify_jwt = false` set per function, **no Supabase JWT/anon key is required** at the gateway (same as GBR's Stripe webhook). See "Authentication & data flow" above. `calculate-ratings` + the Stripe/Resend webhook functions are the existing templates.

### `sync-player-identity`
```
POST /functions/v1/sync-player-identity
in:  { source: 'facilitypresence', externalId: string, firstName, lastName,
       gender, email?: string }
out: { gbrPlayerId: string, created: boolean, claimed: boolean }
```
Implements the resolution order in §1. Idempotent on `(source, externalId)`.

### `submit-match-result`
```
POST /functions/v1/submit-match-result
in:  { externalMatchId: string,                 // == FP DropInAssignment.assignmentId
       teamType: 'singles'|'doubles'|'mixed_doubles', // open SINGLES->singles, open DOUBLES(any genders)->doubles, strict->mixed_doubles. GBR has NO gender-composition constraints (verified) — gender-mixed teams submit safely.
       sideA: string[],  // GBR player ids (1 or 2)
       sideB: string[],
       winnerSide: 'A'|'B',
       sets: {a:number,b:number}[],              // per-game scores; GBR stores match_sets + uses margin-of-victory (A14)
       datePlayed: string,                       // ISO
       weight: 1.0 }                             // self-reported tier
out: { matchId: string, ratingsUpdated: {playerId, mu, sigma}[] }
```
Behavior:
1. **Idempotency:** if a `matches` row with this `external_match_id` exists, return it (no double-count).
2. Create or reuse `teams` rows for each side (by player ids + `team_type`).
3. Insert `matches` with `winner_team_id`, `submitted_by` (the FP service identity), **`match_weight = 1.0`**, and **`verification_status = 'confirmed'`** — because **FP has already performed the two-party confirmation** before calling (see below). **Do not set `is_imported`** (that would apply the 2.0× weight). Then insert the **per-set scores into `match_sets`** — GBR's TrueSkill applies a margin-of-victory multiplier, so the gaps matter (A14).
4. Invoke `calculate-ratings` internally (service-role) to update mu/sigma, then return them. (GBR's client invokes it via `supabase.functions.invoke({ body: { match_id } })`; our function does the same server-side — no Bearer-auth/ownership-check friction.)

FP builds `sideA`/`sideB` (GBR player ids) from the assignment's `DropInAssignmentParticipant` rows — each participant's `side` (A/B) and resolved `gbrPlayerId`.

> **Confirmation ownership.** GBR's native self-report flow is async (opponent confirms later). FP instead owns confirmation in its own submit/confirm state machine ([rotation-engine.md](./rotation-engine.md)) so courts keep moving. FP only calls `submit-match-result` **after** the result is `CONFIRMED` on the FP side — so GBR receives an already-confirmed self-reported match. Walkovers/staff-voided matches are submitted with `weight: 0` (or simply not submitted) and marked `SKIPPED` on FP.

### `get-rankings` (or direct read)
```
POST /functions/v1/get-rankings
in:  { playerIds?: string[], category?: 'singles'|'doubles'|'mixed', limit?: number }
out: { rankings: { gbrPlayerId, displayRating, rank }[] }
```
Display rating per GBR: `GREATEST(100, LEAST(500, ROUND(100 + (mu - 3*sigma) * 8)))`. Reads are public, so this can also be a **direct Supabase PostgREST select with the anon key** instead of a function — cheaper for the global-rank badge.

---

## 3. Connection facts & credentials

GBR's Supabase is **hosted/managed by Lovable** (not in the owner's own Supabase account). From the GBR repo (`src/integrations/supabase/client.ts`, `.env`, `supabase/config.toml`):

| Fact | Value |
| :--- | :--- |
| Project ref | `avzjeysdljfzjmjpxvur` |
| Project URL | `https://avzjeysdljfzjmjpxvur.supabase.co` |
| REST (PostgREST) base | `https://avzjeysdljfzjmjpxvur.supabase.co/rest/v1/` |
| Edge functions base | `https://avzjeysdljfzjmjpxvur.supabase.co/functions/v1/` |
| Anon/publishable key | present in GBR `.env` (RLS-bound — **cannot** write players/matches as an external backend) |
| **service_role key** | **Not available to us** — GBR runs on **Lovable Cloud (managed)**, which intentionally withholds the service_role key. Reachable ONLY from *inside* an edge function (Lovable injects `SUPABASE_SERVICE_ROLE_KEY` at runtime). |

**Lovable won't clobber our changes.** Per GBR's README, Lovable ↔ git sync is **bidirectional** ("pushed changes will also be reflected in Lovable"), and `supabase/functions/` + `supabase/migrations/` are **version-controlled** (180+ migrations; 18 existing edge functions incl. `calculate-ratings`, `claim-ghost-account`, plus Stripe/Resend functions that already use secrets). So our custom edge functions are git-deployable and can hold secrets the same way those existing functions do.

**Edge functions are mandatory AND sufficient (not merely preferred).** Because Lovable Cloud withholds the service_role key, FP **cannot** write `players`/`matches`/`external_player_identities` directly (those need service-role; the anon key is RLS-blocked). The writes must happen *inside* an edge function, which has the injected service role. FP authenticates with the **anon key (gateway) + a shared `x-fp-secret` header** validated against a function env secret; `verify_jwt = false` per function (precedent: GBR's webhook functions). **Reads (rankings)** use the anon key + PostgREST under public-SELECT RLS — no function needed.

**Open — deploy & secrets on Lovable Cloud:** verify (in the Lovable UI) that custom functions added via git deploy to the managed project, and where to set function secrets. The existing Stripe/Resend functions imply both are supported. **Only true fallback** if not: migrate GBR off Lovable Cloud to a self-managed Supabase (full service_role + CLI) — heavier, justified if the FP↔GBR stitch becomes core.

---

## 4. Submission loop, idempotency, graceful degradation

- **Trigger:** a `DropInAssignment` reaching `CONFIRMED` sets `gbrSyncStatus = PENDING`.
- **Worker:** an FP job scans `gbrSyncStatus IN (PENDING, FAILED)` and calls `submit-match-result`; on success → `SENT` + `gbrSyncedAt`; on error → `FAILED` + `gbrSyncError` (re-attempted with backoff).
- **Idempotency:** `externalMatchId = assignmentId` (unique on both sides) means retries never double-count.
- **No local rating fallback** (owner decision): if GBR is down, **play is unaffected** — rotation, queue, and the FP leaderboard are all FP-side. Only the GBR rating update and global-rank badge are delayed; the badge degrades to last-known or hidden.

---

## 5. Embed / read boundary

- The drop-in **board is FP-native** (`/events/[id]`). We are **not** embedding GBR's `/league/:slug/display` or `/live/:sessionId` for drop-in (per the GBR maintainer, not relevant here).
- GBR is used **read-only for the player's global rank**, rendered natively in FP next to the FP drop-in leaderboard (via `get-rankings` or a direct PostgREST read).
- A future option (not in this scope) is embedding a GBR **player-profile** view via iframe + URL params; if pursued, GBR would need a public, themeable, chrome-less variant (it has `/league/:slug/display` as a precedent but no public leaderboard route or URL theming params yet).

---

## Two leaderboards, two jobs

- **FP drop-in leaderboard** — per-session / per-club standings computed from FP-recorded results (uses the shared `calculateStandings` helper). This is the "today's ladder" players watch on the board.
- **GBR global rank** — the player's TrueSkill standing across *all* their play; drop-in matches nudge it at 1.0×. Read from GBR for display only.

Drop-in match data's session/series association stays **only on FP**; GBR stores standalone matches (no league/season linkage).
