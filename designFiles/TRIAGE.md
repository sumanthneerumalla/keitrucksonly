# ShuttleMentor — Launch Triage & Vulnerability Report

> **Last updated: 2026-06-22.** Owner context: first customer is a badminton club (Fung) moving
> off Pike13. Primary revenue = drop-in packages, court rentals, training/classes. Not
> membership-heavy for v1. Goal of this doc: fastest path to a live, paying club.

---

## What Got Done Since Last Update (2026-06-10 → 2026-06-22)

The sprint was productive. Here's what landed, in rough order of impact:

| Done | Feature | Commit(s) |
|------|---------|-----------|
| ✅ | **Club landing page — full Phase 16** (hero, events, about, OG images, JSON-LD SEO, short-URL calendar, club-chromed event pages, branding) | Phase 16 Steps 0–5 |
| ✅ | **Onboarding carry-through** — Clerk strips query params on redirect; sessionStorage side-channel now carries `{club, facility, next}` through sign-in. `/join` is membership-first with auto-search. | feat(onboarding) |
| ✅ | **Checkout sign-in gate** — auth-required checkouts (membership, rental) no longer dead-end at missing `/sign-in`. `CheckoutSignInGate` stashes intent and routes through `/join`. | fix(checkout) |
| ✅ | **Barcode scanner** — document-level keydown listener so hardware scanners work regardless of focused element. No more "keep the search box focused" requirement for front desk. | feat(checkin) |
| ✅ | **Email: invoice via email** — invoices can be sent directly to members via email | Invoice through mail |
| ✅ | **Email: event registration confirmation** — confirmation email sent on event sign-up | event registration confirmation mail update |
| ✅ | **Email: event cancellation** — cancellation email sent when staff or member cancels | event cancellation mailing update |
| ✅ | **Phase 10c — Memberships: family/household + add-on fees** — `memberCapacity`, add-on fee menu, sell modal checkboxes, live total, coverage shown at check-in | feat(memberships) |
| ✅ | **Phase 9c — Invoice notes** — `InvoiceNote` model, staff-attributed notes on all invoice surfaces + PDF, timeline audit entries | feat(invoice) |
| ✅ | **Invoice PDF** — content-hash caching (never stale), invoice-number font render fix | refactor(invoice-pdf) |
| ✅ | **Security: HSTS header** — `max-age=31536000; includeSubDomains` in Caddy config | Add HSTS header |
| ✅ | **Security: CSP** — staged rollout (`report-only` → `enforce` → `off`), per-request nonce, Clerk/Stripe/YouTube allowlists, `CspReport` table + `/api/csp-report` collector | Add staged CSP |
| ✅ | **Security: npm HIGH vulns resolved** — dompurify → 3.4.11, undici → 7.28.0, vite → 8.0.16 | This PR (triaged-items) |
| ✅ | **Branding** — real FP favicon (SVG + PNG + apple-icon), `fp-logo.svg`, OG PNG fallbacks for social scrapers | feat(branding) |
| ✅ | **UI staleness fix** | UI staleness fix |
| ✅ | **Mail subject update** — club name added to email subjects (PR #55, open) | mail subject update |

---

## Priority Checklist — Fastest Path to Go Live

### Methodology
Items are ordered by **impact × completeness gap**. A large feature that's 95% done outranks a
small feature that's 0% done. Features gating revenue (payments, check-in, package credits) come
first regardless of build status because a broken money pipe = no launch.

---

### 🔴 P0 — Launch Blockers (nothing ships until these are green)

| # | Item | Status | Why it matters |
|---|------|--------|----------------|
| 1 | **Stripe Connect end-to-end smoke test** | Built; **never QA'd in staging** | Zero revenue if payments can't be taken. Full flow: connect account → checkout session → webhook → credit issued. Confirm `ClubStripeAccount` row writes correctly. Verify orphan queue stays empty. |
| 2 | **Package sell → credit consume → check-in pipeline** | Built; needs e2e browser pass | Create plan → sell to member → check in → deduct credit → balance reflected on next check-in search. This is the core daily revenue loop. |
| 3 | **Admin check-in + QR self-check-in** | Built; needs browser pass | Staff finds member, marks attended, package balance updates. QR scan → `selfCheckin` → deduct credit. The front-desk workflow. |
| 4 | **Court Rentals booking flow** | Built; needs smoke test | Create rental window → slot visible in availability grid → member books → appears on calendar. Club's #2 revenue source. |
| 5 | **Onboarding gate — drop-in queue** | `/join` page done; gender set-once done; **drop-in queue gate NOT implemented** | New users can skip profile and end up in a broken state during Rotation Play. Not blocking if demo is staff-only, but must land before member self-serve. |

---

### 🟡 P1 — High value, ship in Week 1–2 after soft launch

| # | Item | Status | Why it matters |
|---|------|--------|----------------|
| 6 | **Memberships QA (Phase 10a/10b/10c)** | All built (1035-line router, family/household, add-on fees, registration fee on sale). **Needs QA pass.** | Biggest demoable chunk. Fung isn't membership-heavy but being able to show create plan → sell → view on member card → freeze/cancel makes a strong impression. This outranks Drop-in demo because it's a larger net-new feature surface. |
| 7 | **Drop-in Rotation Play browser verification pass** | Router + UI fully built (DI-2/DI-4). HANDOFF calls out "browser-verification pass" as the remaining step. | Biggest differentiator vs Pike13. Verify MATCH mode, kiosk QR, party join, score report/confirm, dispute resolution, add/remove court mid-session. |
| 8 | **Club landing page live with real club data** | Phase 16 complete at `/[shortName]`. Needs real content seeded. | This is the member-facing front door. Load Fung's branding, real events, address. Share the URL. |
| 9 | **Transactional email coverage audit** | Registration + cancellation + invoice emails shipped. Need to verify package-purchase email and check-in email are wired. | Clubs expect automated emails for every money event. |

---

### 🟢 P2 — Ship before month-end

| # | Item | Status | Why it matters |
|---|------|--------|----------------|
| 10 | **Invoices / billing history QA** | `InvoiceListClient` + router + PDF all built (Phase 9a/9b/9c). **Needs smoke test.** | Sell package → view invoice → record payment → download PDF. Staff uses this daily. |
| 11 | **MemberClubProfile fields** | Schema done; `ProfileFieldsCard` exists. | Staff needs phone, emergency contact on the client detail page. Verify all fields render and are editable. |
| 12 | **Basic revenue report** | Phase 14 not built. | Even a simple "packages sold this week/month" table on `/admin` helps close the books. Small scoped query on `MemberPackage + Invoice`. |
| 13 | **Email groups / campaigns** | Router + compose flow + Resend webhook built. Needs browser pass. | Announcements to members. Group create → add members → compose → send. |
| 14 | **Capacity enforcement on checkout** | Needs verification. | Confirm checkout is blocked once `maxParticipants` is reached for `BOOKABLE`/`COACHING_SLOT`. |

---

### ⚪ P3 — Post-launch backlog

| # | Item | Notes |
|---|------|-------|
| 15 | GBR stitch (DI-5) | Blocked on setting up GBR service account + service user |
| 16 | Drop-in Track C lifecycle (headless cron, G7 one-session-at-a-time enforcement) | Currently unenforced; staff can work around it |
| 17 | Recurring event registration migration (R1/R2) | Guarded with TODOs; only needed when split-scope recurring events appear |
| 18 | Waivers / consent system (Model 4) | Explicitly out of scope for v1 |
| 19 | Full reporting suite (Phase 14) | A/R, revenue by category, package sales reports |
| 20 | M3 Admin invite-member flow | Blocked on `UserClub` deploy + Clerk backend API |
| 21 | CI/CD pipeline, monitoring (Sentry/Datadog) | Post-launch infra |
| 22 | Algorithmic pairing modes (Americano/Mexicano/Ladder) | Post-v1; self-formed pairs is the v1 default |

---

## NPM Vulnerability Report

### Current state — 2026-06-22 (after `npm audit fix` in this PR)

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 | — |
| **High** | **0** ✅ | Fixed in this PR (undici 7.28.0, vite 8.0.16) |
| Moderate | 3 | All postcss — unfixable until Next.js upgrade (see below) |
| Low | 0 | — |

### Vulnerability history

| Date | Action | Result |
|------|--------|--------|
| 2026-06-10 | Original audit (TRIAGE.md) | 0 High, 3 Moderate (postcss only) |
| 2026-06-17–18 | New HIGH vulns appeared: vite 7.0–7.3.3, undici 7.0–7.27.2, dompurify ≤3.4.10 | 2 High, 4 Moderate |
| 2026-06-18 | PR #54 "critical and high issue fix" merged — fixed something but **lockfile still had vulnerable versions** | 2 High, 4 Moderate remained |
| 2026-06-22 | **This PR:** `npm audit fix` → dompurify 3.4.11, undici 7.28.0, vite 8.0.16 | **0 High, 3 Moderate** ✅ |

### The remaining 3 moderate — postcss

```
postcss < 8.5.10  →  next (15.5.x bundles it)  →  @clerk/nextjs (peer dep on next)
```

**CVE:** [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
**Title:** PostCSS XSS via Unescaped `</style>` in CSS Stringify Output
**CVSS:** 6.1 (Moderate). Requires attacker-controlled CSS at **build time** — not at runtime.

**Attack surface:** PostCSS runs during CSS compilation, not in response to user requests. No
user-uploaded CSS is processed at build time. Practical exploitability is **very low**.

### Options for the remaining postcss moderate

#### Option A — Upgrade to Next.js 16 (recommended when ready)

```bash
npm install next@latest
```

Next.js 16 almost certainly ships with postcss ≥ 8.5.10. This is a **major version** and
requires a full compatibility pass (App Router, middleware API) before shipping to production.

**Effort:** High. **Risk if deferred:** Low (build-time only).

#### Option B — Force override ⚠️ Does NOT work

> **Investigated 2026-06-11:** Both global and scoped `"overrides": { "postcss": ">=8.5.10" }`
> were tested against npm 10.x + Next.js 15.5.x. Neither removed
> `node_modules/next/node_modules/postcss@8.4.31` — Next.js pins it exactly and npm 10.x
> cannot override exact-pinned nested deps. Skip this option.

#### Option C — Accept and document (current recommendation)

Given build-time-only attack surface, CVSS 6.1, and no working fix path for Next.js 15.x,
accept the risk and re-evaluate when upgrading to Next.js 16.

**This should never block launch.** Re-evaluate at next Next.js major upgrade.

---

## Open Technical Debt (carry into every sprint)

| Item | Notes |
|------|-------|
| Gender required drop-in gate | G7 unenforced; `joinQueue` has no onboarding check |
| `getCoachDashboardMetrics` cleanup | Still flagged in `nextSteps.md` |
| Video collection DB queries in page component | Should use paginated tRPC endpoints |
| `noLabelWithoutControl` a11y warnings | Pre-existing in profile + ClientsList; do a broader a11y pass |
| Coach filter UI | `CoachFilters` component not built; filtering is API-only |
| Multi-court conflict detection | ✅ Fixed (commit `9bf086f`) — `OR [resourceId, resourceIds.has]` in both query branches |
