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

### 2. Memberships ← COMPLETE (Phase 10a)
- ✅ Membership types (different tiers per club)
- ✅ Start date, end date
- ✅ Freeze/postpone memberships (extend end date)
- ✅ Membership renewal settings
- ✅ Link memberships to clients (sell + bill-to, SellMembershipModal)
- ✅ Visual status at check-in (display only, no enforcement)

**Design doc:** `roadmap/phase10-memberships.md`
**⚠️ Action required:** Migration `20260528010832` must be applied to production DB before enabling.

### 3. Billing & Revenue ← COMPLETE
- ✅ Manual package assignment by staff, pay at desk (Phase 8a)
- ✅ Invoicing & running tab, refunds, void (Phase 9a)
- ✅ Invoice PDF generation (Phase 9b)
- ✅ Stripe Connect payments (Phase 12a — replaces Polar)
- Revenue categories for products/packages (Phase 5c — deferred)
- Accounts receivable, revenue reports, package sales reports (Phase 14 — not started)

**Design docs:** `roadmap/phase9-invoicing.md`, `roadmap/phase14-reporting.md`

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

| Phase | Doc | Status |
|---|---|---|
| Phase 1: Platform foundations | — | Complete ✅ |
| Phase 2: User Management | `phase2-user-management.md` | Complete ✅ |
| Phase 2.5: Calendar & Public Embed | `progressPhase2_5.md` | Complete ✅ (C1–C5 done; R1/R2 deferred) |
| Phase 3: Payments (Stripe Connect) | `progressPhase3.md` | Complete ✅ (Phase 12a Stripe replaces Polar) |
| Phase 4: User Tags | `phase4-user-tags.md` | Complete ✅ |
| Phase 5a: Products & Categories | — | Complete ✅ (ProductsClient, ProductFormModal) |
| Phase 6a: Member Check-in | — | Complete ✅ (static QR + self-check-in) |
| Phase 7a: Admin Check-in | — | Complete ✅ (admin page + sell flows) |
| Phase 8a: Packages & Credits | — | Complete ✅ (PackagePlan, MemberPackage, credit usage) |
| Court Rentals CR-a | — | Complete ✅ (rental window events + /rentals grid) |
| Phase 9a: Invoicing | — | Complete ✅ (running tab, billing, refunds, void) |
| Phase 9b: Invoice PDF | — | Complete ✅ |
| Phase 10a: Memberships | — | Complete ✅ — **⚠️ migration 20260528010832 must be applied to prod** |
| Phase 12a: Stripe Connect | — | Complete ✅ (PaymentProvider, checkout, webhooks) |
| Drop-in Rotation DI-2/DI-4 | `drop-in/HANDOFF.md` | Complete ✅ (TIMED + MATCH, kiosk, QR, party join) |
| Multi-facility (F-A through F-E) | `progressPhase2_5.md` | Complete ✅ |
| Multi-club (M1/M2/M4) | `progressPhase2_5.md` | Complete ✅ (M3 admin invite deferred) |
| Recurring event reg migration | — | Deferred (R1/R2 — guarded TODOs, low priority) |
| Phase 13: Communications | — | Not Started |
| Phase 14: Reporting | — | Not Started |
| DI-5: GBR stitch | `drop-in/gbr-integration.md` | Not Started (blocked on owner GBR setup) |

---

## Tech debt / prerequisites (from nextSteps.md)

- ✅ Club landing shortname leak — FIXED (S1/S2 in progressPhase2_5.md)
- ✅ Input sanitization on user fields — FIXED (firstName/lastName/timezone regex)
- ✅ Video collection pagination — FIXED (B1)
- ✅ Coach dashboard cleanup — FIXED (D2)
- ✅ Sidebar migration to shadcn — FIXED (U1)

---

## Launch priorities (to be confirmed with customer Fung)

- Accounts receivable, invoices, revenue report, package sales — example docs requested (see open-questions.md Q13)
- New facility will mainly have training/classes, drop-ins, and court rentals
- Customer currently uses Pike13
- Open questions tracked in `roadmap/open-questions.md`
