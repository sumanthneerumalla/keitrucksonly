# Drop-In — Open Questions & Discussion Points

Gaps to fill, like the FP↔GBR comms refinement. **Priority:** 🔴 blocker · 🟡 soon · 🟢 later. **Decides:** 👤 Owner · 🛠️ FP-eng · 🟣 GBR-maintainer.

Most of A–D are **resolved** (owner, 2026-06-02) — see the Resolved section. Still open: **E, F, and the new sub-questions below** raised by those answers.

---

## Still open

### New sub-questions (from the 2026-06-02 answers)

| ID | Question | Default | Pri | Decides |
| :-- | :-- | :-- | :-- | :-- |
| A12 | **Doubles queue unit & partner editing.** | ✅ **Decided:** v1 = **self-formed editable pairs** (queue as a pair; edit partner before rejoining). **Americano / Mexicano / Ladder** are wanted **later** (future modes) → F3 (shared pairing pkg) deferred for v1. | — | 👤 |
| A13 | **Who acts for a side in doubles report/confirm.** | ✅ **Decided:** any one player on a side acts for the side. | — | 👤 |
| A14 | **GBR score shape for best-of-3.** | ✅ **Found:** GBR stores **per-set scores** (`match_sets`: team_a_score/team_b_score per set) and its TrueSkill applies a **margin-of-victory multiplier (0.5–1.5×)**. → Submit the **actual per-set scores** (not just games-won); the point gap affects rating. FP must capture per-game scores at report time. | — | 🛠️🟣 |
| A16 | **Per-court continuous vs synchronized rounds.** | ✅ **Decided:** **per-court continuous** — each court pulls its next match when *it* frees; no waiting for other courts. | — | 👤 |
| B6 | **Gender value set.** | ✅ **Found:** GBR `gender` is an enum of exactly **`male` / `female`** — FP's required field uses those two. | — | 🛠️ |
| N1 | **Turn / confirm notifications.** | ✅ **Decided:** in-app/on-board indicators for v1; push later. | — | 👤 |

### E. Operations / staff

| ID | Question | Default | Pri | Decides |
| :-- | :-- | :-- | :-- | :-- |
| E1 | **Staff override actions + roles.** | ✅ **Decided:** ALL in v1 — end timed slot early, start/advance next match, cancel match, enter/override score, resolve dispute, remove/re-queue/reorder player, add/remove courts, pause/resume, end session, manual walk-in check-in. Role = **Facility+** (FACILITY & ADMIN). | — | 👤 |
| E2 | **Session lifecycle.** | ✅ **Decided (time-driven soft):** no mandatory start button; active during the **event's scheduled window** (materialized lazily on first check-in). At window end: **stop forming new matchups**; **let in-progress matches finish + report** (still sync — also the least logic to build); lingering unresolved ones **auto-cancel** after a grace (not synced). Optional staff **end-now / extend**. | — | 👤 |
| E3 | **Multi-facility.** | ✅ **Decided:** **one facility per session** — don't mix courts from different facilities in one drop-in event. | — | 👤 |

### F. Cross-product engineering

| ID | Question | Default | Pri | Decides |
| :-- | :-- | :-- | :-- | :-- |
| F1 | **Deploy of NEW edge functions on Lovable Cloud.** | ✅ **Decided:** owner will **manually deploy on Lovable** if a git push doesn't auto-pick-up new functions. | — | 👤 |
| F2 | **`submitted_by` for FP matches.** | ✅ **Decided + found:** `submitted_by` is `NOT NULL REFERENCES auth.users(id)`. Create the **ShuttleMentor service account** as a real auth user (simplest: sign it up via GBR's normal signup + ProfileSetup; or Dashboard "Add user"), then its `auth.users.id` → the `FP_SERVICE_USER_ID` Saved Secret. | — | 👤 |
| F3 | **Shared pairing package logistics** — FP & GBR are **separate repos**. | ⏸️ **Deferred for v1** (v1 doubles = self-formed pairs, A12). When algorithmic modes land: **option (c) — vendored copy** from GBR into FP (with a "synced on date X" note). | 🟢 | 🛠️ |
| F4 | **Contract versioning.** | ✅ **Decided:** version the function paths (`/v1/`). | — | 🛠️ |
| F5 | **GBR maintenance ownership.** | ✅ **Decided:** **owner maintains** the GBR functions (has repo access). | — | 👤 |

### G. Second-order questions (surfaced 2026-06-02 — mostly defaultable)

| ID | Question | Default | Pri | Decides |
| :-- | :-- | :-- | :-- | :-- |
| G1 | **Account requirement by mode.** | ✅ **Decided:** **TIMED and MATCH both require FP accounts** (players log in to join queue / report / confirm). **MANUAL** = front-desk check-in only, no FP login/interaction. | — | 👤 |
| G2 | **How players enter a session.** | ✅ **Decided:** reuse the existing **front-desk (staff) check-in**. | — | 👤 |
| G3 | **Drop-in leaderboard — metric & placement.** | ✅ **Decided:** rank by matches won → head-to-head → point differential (`calculateStandings`); shown **on the drop-in event page** (the board), per session. | — | 👤 |
| G4 | **GBR rating on the board.** | ✅ **Decided:** show it once the GBR stitch (DI-5) lands; not earlier. | — | 👤 |
| G5 | **Live updates & notifications.** | ✅ **Decided:** **polling is sufficient** (no sockets in v1). The event page polls for latest assignments + standings; the "your turn / report / confirm" prompts are just the polled board reflecting each user's state. True push deferred. | — | 👤 |
| G6 | **TIMED rotation length.** | ✅ **Decided:** staff-configurable — **default 15 min, max 30, in 5-min increments** (15/20/25/30). | — | 👤 |
| G7 | **One active drop-in per player.** | ✅ **Decided:** enforce — a player can be checked into only one drop-in session at a time. | — | 👤 |
| B7 | **Gender immutability + admin override** (B1). | ✅ **Decided (option a):** **set-once** for the user — server guard in `updateProfile` (write only when current gender is null) + UI shows it **read-only** once set. **No DB trigger** — admins can correct a mistake by editing the DB directly if ever needed (out-of-band; no special admin mutation in v1). | — | 👤 |
| G8 | **Public (logged-out) drop-in viewing / leaderboard** for spectators. | ✅ **Decided — REUSE the existing public event page, NOT an iframe embed.** `EventDetailClient` (`/club/[shortName]/shop/events/[eventId]` + `/events/[eventId]`) is already public-capable (renders for logged-out users — `userId=""`, no redirect; `isPublic` gate + `showRegistrantNames` + `publicProcedure` + guest-register all exist). Plan: (1) add `DROP_IN` to the `calendar.getPublicEvents` eventType filter; (2) a `publicProcedure` board read (extend `getPublicEventById` or a `getPublicDropInBoard`) gated by `isPublic`, names per `showRegistrantNames`; (3) `EventDetailClient` DROP_IN branch = read-only board for public + interactive for authed, with a "sign in to join/report" CTA; (4) global rankings via GBR's own public pages. Lands with standings in **DI-4/DI-5** (MANUAL has none). | — | 👤🛠️ |

---

## Resolved (owner, 2026-06-02)

**A — Product / rules**
- **A1** TIMED group formation = **FIFO** (write it toggleable for later). New work: a **group create/join UI** for both TIMED & MATCH. Playing requires **check-in to the event instance**.
- **A2** TIMED no-show: just **start the timer + notify** it's their turn; if it times out, it times out; **admin can end a timed slot early**. MATCH no-show: **leave the match until someone complains / staff starts the next round.** Rejoining the queue is always **manual**.
- **A3** MATCH: to get your next match you must **report your own score AND confirm your opponent's**; not doing either locks you out of the queue. Either side may **dispute** → **both locked** until staff resolves + records the final score. **TIMED records no score.** Games per match: **best 2-of-3** (A11). **Drop-in status is fully SEPARATE from event-registration status.**
- **A4** Fairness ordering as drafted (games↑, lastPlayed↑, queued↑); make it **configurable later**, this is just the default.
- **A5** Fee = **the event's cost** — behaves like any other event: owner makes a drop-in **product**, links it to the event (else free); players **register + pay via Stripe** or are **added/paid manually at the front desk** (cash/POS).
- **A6** `maxParticipants` + **waitlist the session when full**.
- **A7** **Fixed format per session, default DOUBLES.** Players may **edit their partner between rounds** before rejoining (see A12).
- **A8** **All MATCH games submit to GBR by default** (no opt-out in v1).
- **A9** **Allow** staff to add/remove drop-in courts mid-session.
- **A11** **Single game to 21; best 2-of-3** is the default; configurable later.
- **A15** MATCH **auto-starts** the next matchup the instant a court frees (the previous match's first report); no dwell in `ASSIGNED` (kept only for staff pre-assign / transient). The court keeps rotating regardless of whether the prior score is confirmed.

**B — Identity**
- **B1** Make **`gender` a REQUIRED field on the FP `User`** (DB column) and add it to the **onboarding required-fields flow** (the redirect-to-profile flow that already collects first/last/email). Pass it to GBR at provision.
- **B2** **Skip email dedup** in v1 — rely on `(source, memberId)` idempotency.
- **B3** **Leave ghosts unclaimed** in v1.
- **B4** **Global FP member id** (use `User.userId`) as the `external_id`.
- **B5** **No ToS/privacy work now** (owner will handle later).

**C — Scoring**
- **C1** Drop-in doubles → the player's **doubles category** rating.
- **C2** Staff-set authoritative score still counts at **1.0×**.
- **C3** Show **rating only** (no position) in v1.
- **C4** **Simple retries** (a few attempts + backoff), **no staff alert**.

**D — Realtime / board / hardware**
- **D1** **Polling** (simplest).
- **D2** The **board IS the event page** (`/events/[id]`) — no separate page.
- **D3** Players must **log in (Clerk)** to submit scores.
- **D4** **Kiosk mode = a button on the event page** → fullscreen + unlock audio (no separate kiosk code). On a connected TV the horn plays from the TV. (The button-gesture is also what browsers require to allow sound later.)
- **D5** Match time limits **off in v1**.

---

## Resolved (owner, 2026-06-05 — onboarding session)

> **UPDATED 2026-06-06:** the "Rotation Play / casual `DROP_IN` event / DI-1c" framing below was simplified one step further — **casual drop-in is just a multi-court `BOOKABLE` event**, so there is no `DROP_IN` type for casual and no DI-1c (CANCELLED). The `DROP_IN` type stays reserved for the live-rotation feature only. The non-naming decisions (payment, check-in, occurrenceDate, gender/onboarding gate, a11y) all still hold. See HANDOFF.md "2026-06-06 FINAL decision".

These refine A5/B1/B7/G1/G2 and the open-loops audit. See HANDOFF.md "2026-06-05 onboarding-session decisions" for the operational version.

- **NAME** — the `DROP_IN` event type is presented to club owners as **"Rotation Play"** (*"auto-managed peak-hour matches"*); a new option in the create-event dropdown. Enum stays `DROP_IN`.
- **SCOPE** — ship **casual first**, TIMED/MATCH rotation later (owner OK with the forward-looking label now).
- **⭐ CASUAL ARCHITECTURE (supersedes "MANUAL = DropInSession")** — casual Rotation Play is a **normal registrable/checkable event**: reuse `EventRegistration` + checkout + member `selfCheckin` (`checkin` router) + front-desk check-in. **`DropInSession` + the `dropIn` router (DI-1a/DI-1b) are PARKED for TIMED/MATCH** (DI-2/DI-4); casual does not touch them. The old MANUAL-mode-on-DropInSession design is dropped.
- **A5 wiring** — to make a `DROP_IN` event payable/registrable, extend the `BOOKABLE`-gated branches (Register button + checkout + `calendar.getPublicEvents` filter) to accept `DROP_IN`.
- **Multi-court** — reuse the modal's existing `RENTAL_WINDOW` multi-court picker for `DROP_IN`.
- **occurrenceDate** — normalize to **club-local calendar day** (facility-tz start-of-day); only relevant once `DropInSession` is used (TIMED/MATCH). Non-recurring = `event.start`.
- **Check-in (loop #3)** — members **self-check-in to any registration they own** (already true via `checkin.selfCheckin`); front-desk can also check in. No new check-in system for casual.
- **Admin gender display (loop #4)** — **SKIP**.
- **B1 → required (loop #5)** — `gender` becomes a **hard requirement**, plus an **onboarding-completeness gate** before a user can participate in Rotation Play. Tracked as a **separate work thread** (see HANDOFF "Onboarding completeness gate"), not part of DI-1c.
- **a11y (loop #6)** — fix the `noLabelWithoutControl` warnings (was "accepted"; owner wants them fixed since it needs no project context).
