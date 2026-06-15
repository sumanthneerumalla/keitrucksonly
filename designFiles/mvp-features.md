# MVP Features — First Customer Launch

Master tracking doc for all workstreams needed to launch with the first customer.

> **See also:** [`designFiles/roadmap/MASTER-ROADMAP.md`](roadmap/MASTER-ROADMAP.md) — the authoritative MVP scope, dependency map, sub-phase breakdown, and design decisions for Phases 5–14 + Court Rentals. This doc remains useful as a high-level workstream index but the roadmap folder is the source of truth for implementation planning.

---

## MVP Launch Scope (confirmed)

**MVP = Phases 5a, 6a, 7a, 8a, CR-a**

| Phase | Feature | Design Doc |
|-------|---------|------------|
| 5a | Products & Categories CRUD (no tax, no revenue categories) | `roadmap/phase5-products.md` |
| 6a | Member Check-in Page (static QR, self-check-in) | `roadmap/phase6-member-checkin.md` |
| 7a | Admin Check-in Page (polling, no payment flow) | `roadmap/phase7-admin-checkin.md` |
| 8a | Packages & Credits (fixed-count, manual assignment) | `roadmap/phase8-packages.md` |
| CR-a | Court Rentals (rental window events, slot booking) | `roadmap/court-rentals.md` |

First customer: badminton club (Fung), currently on Pike13. Primary revenue: drop-in packages, court rentals, training/classes. Moving away from required memberships.

---

## Workstreams

### 1. Facility Management
- Multi-facility support (already partially in schema via ClubFacility)
- Location details: address, email, phone
- Logo upload per facility/club
- Accepted payment methods display
- Associate trainers and staff with specific facilities

**Design doc:** TBD (not in current MVP scope)

### 2. Memberships ← POST-MVP
- Membership types (different tiers per club)
- Start date, end date
- Freeze/postpone memberships (extend end date)
- Membership renewal settings
- Link memberships to clients

**Design doc:** `roadmap/phase10-memberships.md`
**Note:** First customer is moving away from required memberships. Visual status indicator at check-in only (no enforcement) when built.

### 3. Billing & Revenue
- **MVP:** Manual package assignment by staff, pay at desk
- Revenue categories for products/packages (Phase 5c — deferred)
- **Invoicing & running tab (Phase 9a/9b — BUILT)**: invoice list/search, detail page, PDF generation, account credit, void, `recordPayment`, member-facing `/invoices`
- Earnings reports with date ranges (Phase 14 — post-MVP)
- Accounts receivable, revenue reports, package sales reports (Phase 14 — post-MVP)

**Design docs:** `roadmap/phase9-invoicing.md`, `roadmap/phase14-reporting.md`
**Payments:** Stripe Connect (Phase 12a — BUILT). Per-club connected accounts, embedded checkout, direct charges, webhooks. **Polar was evaluated and dropped — do not reintroduce.**

### 4. Client Management ← COMPLETE
- **Phase 4: User Tags** — tagging, filtering, bulk tagging, CSV export ✅
- Client export (CSV) ✅
- Contact preferences per client (future)
- Configurable required fields for intake/sign-up forms (future)

**Design doc:** `designFiles/phase4-user-tags.md`

### 5. Events & Calendar ← IN PROGRESS (Phase 2.5)
- Manual registration: go to event, type name to add registrant
- Event statuses: scheduled, attended, no-show, reschedule/early cancel, late cancel, reserved, waitlist
- Calendar generation based on event bookings + settings
- Court rentals, drop-ins, training/classes support
- **Court Rentals (CR-a):** Rental window event type, `/rentals` availability grid

**Design doc:** `designFiles/calendaring/README.md`, `roadmap/court-rentals.md`

### 6. Communications ← POST-MVP
- Customizable email body/text for transaction emails
- Invoice details filled via template variables
- Email campaigns for specifically tagged clients
- Campaign metrics: open rate, click rate

**Design doc:** `roadmap/phase13-communications.md`

### 7. Documents & Waivers ← NOT SCOPED
- Admin-created document/waiver library
- Link waivers to specific packages
- Client signature/acceptance tracking

**Design doc:** TBD

### 8. Reports ← POST-MVP
- Accounts receivable
- Revenue reports (start/end date, location, categories)
- Package sales (name, invoice number, values)
- Training reports: attendance per person, check-in/out times
- Priority (per customer Fung): A/R, invoices, revenue, package sales

**Design doc:** `roadmap/phase14-reporting.md`
**Action needed:** Get example report documents from Fung (see `roadmap/open-questions.md` Q13/Q14)

---

## Phase Status

> **Note:** `designFiles/roadmap/` folder referenced below does not exist yet — docs are TBD.

| Phase | Doc | Status |
|---|---|---|
| Phase 1: Platform foundations | — | Complete |
| Phase 2: User Management | `phase2-user-management.md` | Complete |
| Phase 2.5: Calendar & Public Embed | `progressPhase2_5.md` | Complete (all C1–C5, F-A–F-E, M1–M4, U1–U5 done) |
| Phase 4: User Tags | `phase4-user-tags.md` | Complete |
| Phase 9a/9b: Invoicing + PDF | `roadmap/phase9-invoicing.md` | **Built** — invoice list/detail/PDF, account credit, void, `recordPayment`, `/invoices` + `/admin/invoices`. Needs QA. |
| Phase 12a: Stripe Connect Payments | `roadmap/phase12-stripe-connect.md` | **Built** — per-club connected accounts, embedded checkout, webhooks, dispatch/failure, orphan queue (Accounts v2). Needs QA. **(Replaces the cancelled Polar integration.)** |
| Phase 5a: Products & Categories | `roadmap/phase5-products.md` | **Built** — router + admin UI exist (`/admin/products`, `/admin/products/categories`). Needs QA. |
| Phase 6a: Member Check-in | `roadmap/phase6-member-checkin.md` | **Built** — 760-line router + `/checkin/[clubShortName]/[facilityId]` pages. Needs QA. |
| Phase 7a: Admin Check-in | `roadmap/phase7-admin-checkin.md` | **Built** — `/admin/checkin` page with SellPackageModal + MemberPackagesCard. Needs QA. |
| Phase 8a: Packages & Credits | `roadmap/phase8-packages.md` | **Built** — 590-line router + `/admin/packages` UI. Needs QA. |
| Court Rentals CR-a | `roadmap/court-rentals.md` | **Built** — 1074-line router + `/rentals` + `/admin/rentals` UI. Needs QA. |
| Drop-In Rotation (DI-2 + DI-4) | `drop-in/HANDOFF.md` | **Built** — Full rotation engine, kiosk/QR mode, party/group join, mobile UI. |
| Memberships | `roadmap/phase10-memberships.md` | **Built** — 1035-line router + `/admin/memberships` (plans, types, preferences). Post-MVP. Needs QA. |
| Phase 9+: Post-MVP | `roadmap/MASTER-ROADMAP.md` | Not Started |

---

## Go-Live Checklist (Priority Order — Updated 2026-06-15)

> Focus: fastest path to a demoable, sellable product for a badminton club (club like Fung's). Each item below is one meaningful feature block a club operator would actually use in day one.

### Tier 1 — Must Have Before First Demo

- [ ] **QA: Admin Check-in flow** (`/admin/checkin`) — staff sells packages, marks members checked in. This is the front-desk workflow and the first thing a club will try. Verify SellPackageModal, MemberPackagesCard, and the check-in log work end-to-end.
- [ ] **QA: Member Self Check-in** (`/checkin/[clubShortName]/[facilityId]`) — member scans QR, checks themselves in. Verify the static QR works and check-in registers correctly.
- [ ] **QA: Products & Categories CRUD** (`/admin/products`, `/admin/products/categories`) — admin creates a product (e.g. "Drop-In $10"), assigns a category. This is the prerequisite for selling anything.
- [ ] **QA: Packages & Credits** (`/admin/packages`) — admin creates a package (e.g. "10 Drop-Ins"), sells it via `/admin/checkin`, member's credits decrement. The core revenue loop.
- [ ] **QA: Court Rentals** (`/rentals`, `/admin/rentals`) — member books a court slot; admin sees it on the board. Club's #2 revenue source.
- [ ] **QA: Stripe Connect end-to-end** (Phase 12a, built) — connect the club's Stripe account via the onboarding banner, then run a real checkout for each item kind (package, rental, invoice). Verify the webhook creates the right downstream rows and the orphan queue stays empty. This is the live-money path; QA it hard before go-live.

### Tier 2 — High Value, Ship in Week 2

- [ ] **Drop-In Rotation demo** (`/drop-in` board, kiosk QR) — DI-2 TIMED + DI-4 MATCH are fully built. Run a real drop-in session end-to-end: check-in players, rotate courts, score a match. Very impressive demo moment.
- [ ] **Onboarding completeness gate** — Gate Drop-In participation (and check-in) on completed profile (gender, name). The handoff doc flagged this as a separate thread. Without it, new users can skip profile completion and end up in a broken state.
- [ ] **Invoices / running tab** — `/invoices` + `/admin/invoices` are built (Phase 9a/9b). Verify staff can pull up a client's account, see balance/outstanding, record a payment, and generate a PDF.
- [ ] **Event Calendar** — public club calendar at `/club/[shortName]/calendar`, embeddable widget. Already built; just needs a real club's events loaded and the URL shared with members.

### Tier 3 — Ship Before Month-End

- [ ] **Memberships** (`/admin/memberships`) — router is 1035 lines and admin pages exist. Fung is moving away from required memberships, but a status indicator at check-in (member vs. non-member) is low-effort and adds credibility.
- [ ] **Capacity enforcement on checkout** — confirm checkout is blocked once `maxParticipants` is reached for BOOKABLE/COACHING_SLOT, and that a `COACHING_SLOT` flips `isBlocking` on purchase. Verify against the Stripe Connect flow (not a Polar item).
- [ ] **Security: input sanitization** — firstName/lastName regex was added but timezone validation and DB-layer enforcement should be audited. Low-effort hardening.

### Tier 4 — Post-Launch Polish

- [ ] Communications / email campaigns (Phase 13)
- [ ] Reports / A/R dashboard (Phase 14)
- [ ] GBR stitch (DI-5) — identity sync + 3 edge functions
- [ ] CI/CD pipeline, monitoring, Sentry/Datadog
- [ ] Per-club-profiles and M3 (admin invite flow)

---

## Tech debt / prerequisites (updated 2026-06-15)

- ~~Club landing shortname leak~~ — **Fixed** (S1 + S2 done in Phase 2.5)
- ~~Sidebar migration to shadcn~~ — **Done** (U1–U2)
- ~~Input sanitization on user fields~~ — **Partially done** (name regex added; DB-layer enforcement TBD)
- ~~Video collection pagination~~ — **Done** (B1)
- Coach dashboard cleanup — still pending (low priority)
- **Multi-court conflict detection gap** — tracked in `drop-in/multi-court-conflict-TODO.md`. **This is NOT a quick fix.** The shipped "quick version" only loops the conflict check over courts the *new* event holds; it still matches *existing* events by their single `resourceId` column, so two multi-court BOOKABLE events sharing an extra court can double-book. The real fix is comprehensive: OR-match on `resourceId`/`resourceIds` in **both** `checkResourceConflicts` **and** `checkRecurringEventConflicts`, audit every caller + the recurring-occurrence expansion, and add regression tests — followed (separately) by the deferred `CalendarEventResource` join-table unification. Scope and sequence per the TODO doc; do not treat as a one-liner.

---

## Launch priorities (to be confirmed with customer Fung)

- Accounts receivable, invoices, revenue report, package sales — example docs requested (see open-questions.md Q13)
- New facility will mainly have training/classes, drop-ins, and court rentals
- Customer currently uses Pike13
- Open questions tracked in `roadmap/open-questions.md`
