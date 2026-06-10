# ShuttleMentor — Launch Triage & Vulnerability Report

> Generated: 2026-06-10. Owner context: first customer is a badminton club (Fung) moving off
> Pike13. Primary revenue = drop-in packages, court rentals, training/classes. Not
> membership-heavy for v1. Goal of this doc: fastest path to a live, paying club.

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
| 1 | **Stripe Connect end-to-end smoke test** | Built; untested in staging | Zero revenue if payments can't be taken. Full flow: connect account → checkout session → webhook → credit issued. Also confirm `ClubStripeAccount` row writes correctly on return from Stripe. |
| 2 | **Admin check-in + QR self-check-in verification** | Built; needs browser pass | Staff must be able to find a member, mark attended, and see their package balance update. QR scan → `selfCheckin` → deduct credit. |
| 3 | **Package sell → credit consume pipeline** | Built; needs e2e test | Create plan → sell to member → check in → deduct credit → balance reflected on next checkin search. This is the core drop-in workflow the club uses daily. |
| 4 | **Court Rentals booking flow** | Built; needs smoke test | Create rental window → slot visible in availability grid → member books → appears on calendar. |
| 5 | **Onboarding gate hardening** | `/join` page done; gender set-once done; **drop-in participation gate NOT implemented** | A new user must be onboarded before they can join a Rotation Play queue. Not blocking for initial launch if Rotation Play is demoed to staff-only, but gate must land before member self-serve. |

---

### 🟡 P1 — Week-1 after soft launch

| # | Item | Status | Why it matters |
|---|------|--------|----------------|
| 6 | **Drop-in Rotation Play browser verification pass** | Router + UI fully built (DI-2/DI-4); HANDOFF explicitly calls out "browser-verification pass" as remaining | This is the biggest differentiator vs Pike13. Staff demo will be the make-or-break moment. Verify MATCH mode, kiosk QR, party join, score report/confirm, dispute resolution, add/remove court mid-session. |
| 7 | **Memberships smoke test (Phase 10a)** | Types, plans, preferences, sell modal, member card all built (1035-line router) | Even though Fung isn't membership-heavy, being able to show it works is a sellable feature. Sell → view on member card → freeze/unfreeze → cancel. |
| 8 | **Email notifications (transactional)** | Resend integration + send log built; confirmation emails may not be wired to all triggers | Clubs expect automated emails on package purchase, registration, check-in. Check `emailSend.ts` trigger coverage and fill any gaps. |
| 9 | **Member profile fields (MemberClubProfile)** | Schema + migration done; `ProfileFieldsCard` exists | Staff needs phone, emergency contact visible on the client detail page. Verify all `MemberClubProfile` fields render and are editable by facility staff. |

---

### 🟢 P2 — First-month polish

| # | Item | Status | Why it matters |
|---|------|--------|----------------|
| 10 | **Invoices / billing history** | `InvoiceListClient` + router built | Club needs to look up a member's payment history. Smoke test: sell a package, view the resulting invoice. |
| 11 | **Basic revenue report (packages sold)** | Not built (Phase 14 deferred) | Even a simple "packages sold this week/month" table helps the club close their books. A small scoped query on `MemberPackage` + `Invoice` would suffice for v1. |
| 12 | **Email groups / campaigns** | `EmailGroupsClient`, compose flow, Resend webhook built | Useful for announcements to members. Verify group create → add members → send. |
| 13 | **Multi-court conflict detection fix** | Quick-version gap documented in `multi-court-conflict-TODO.md` | Two multi-court events sharing an extra court won't conflict-detect today. Low-urgency until multi-court bookings are common, but should land before the club's busy season. |

---

### ⚪ P3 — Post-launch backlog (do not block launch on these)

| # | Item | Notes |
|---|------|-------|
| 14 | GBR stitch (DI-5) | Blocked on owner setting up GBR service account + service user |
| 15 | Drop-in Track C lifecycle (headless cron, G7 one-session-at-a-time enforcement) | Currently unenforced; staff can work around it |
| 16 | Recurring event registration migration (R1/R2) | Guarded with TODOs; only needed when split-scope recurring events appear in production |
| 17 | Polar payments (P1–P4) | Stripe Connect is the chosen payment path; Polar is deferred |
| 18 | Waivers / consent system (Model 4) | Explicitly out of scope for v1 |
| 19 | Full reporting suite (Phase 14) | A/R, revenue by category, package sales reports |
| 20 | M3 Admin invite-member flow | Blocked on M1 `UserClub` deploy + Clerk backend API |
| 21 | Algorithmic pairing modes (Americano/Mexicano/Ladder) | Post-v1; self-formed pairs is the v1 default |

---

## NPM Vulnerability Report

Run date: 2026-06-10. Command: `npm audit`.

### Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| **Moderate** | **3** |
| Low      | 0 |

All 3 moderate vulnerabilities trace to a single root cause.

### Root cause

```
postcss < 8.5.10  →  next (15.5.x bundles it)  →  @clerk/nextjs (peer dep on next)
```

**CVE:** [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
**Title:** PostCSS XSS via Unescaped `</style>` in CSS Stringify Output
**CVSS score:** 6.1 (Moderate). Requires a maliciously crafted CSS file to be processed by
PostCSS's stringify step in order to inject a `</style>` tag into the output HTML.

**Attack surface in this app:** PostCSS runs at **build time** (CSS compilation), not at runtime
in response to user requests. The XSS vector requires an attacker to control a CSS source file
that is processed during the build. Since no user-uploaded CSS is processed at build time in
this codebase, the practical exploitability is **very low** in the current setup.

**Why `npm audit --fix` can't auto-fix it:** Next.js 15.x pins its own internal copy of
PostCSS. The fix requires either (a) Next.js to release a patch that upgrades its bundled
PostCSS, or (b) a package-level override.

---

### Options

#### Option A — Upgrade Next.js to v16 (recommended when ready)

```bash
npm install next@latest
```

Next.js 16.2.9 is already available (current: `^15.5.15`). This is a **major version bump**
and requires a full compatibility pass (App Router changes, middleware API, etc.) before
deploying to production. The PostCSS vulnerability will almost certainly be resolved inside
Next.js 16's bundled version.

**Effort:** High (regression testing required). **Risk if deferred:** Low (build-time only).

#### Option B — Force PostCSS version override (lower effort, may break build)

Add to `package.json`:

```json
"overrides": {
  "postcss": ">=8.5.10"
}
```

Then run `npm install`. This forces npm to resolve all `postcss` sub-dependencies to a
patched version. **Risk:** Next.js's internal CSS pipeline may break if it depends on a
specific PostCSS API that changed between versions. Test with `npm run build` before deploying.

**Effort:** Low (15 minutes + verification). **Risk:** Possible CSS build breakage; test first.

#### Option C — Accept and document (no-action for now)

Given that:
- The vulnerability is build-time only
- No user CSS is processed at build time
- The CVSS score is 6.1 (Moderate, not High/Critical)
- A fix requires either a major Next.js upgrade or a risky override

Accept the risk with a documented review date (e.g., re-evaluate when upgrading Next.js or
if the attack surface changes). Add a comment in `package.json` noting the known advisory.

**Effort:** Zero. **Risk:** Acceptable for now; re-evaluate at next Next.js upgrade.

---

### Recommendation

**Short term:** Go with **Option C** (accept + document) for the launch sprint — it's a
build-time-only vulnerability with no user-controlled CSS input, and it should not block
go-live for a club management SaaS. Track it on the backlog.

**Medium term:** After the P0/P1 launch checklist is clear, test **Option B** (override) in
a branch. If `npm run build` is clean, merge it as a quick win. If it breaks CSS, shelve
it until the Next.js 16 upgrade is scheduled.

**Never block launch on this.** The 3 moderate vulns are all the same postcss issue; there
are 0 high and 0 critical vulnerabilities.

---

## Open Technical Debt (carry into every sprint)

These are pre-existing items from `designFiles/nextSteps.md` + HANDOFF that aren't P0 but
will accumulate interest if left too long:

| Item | File | Notes |
|------|------|-------|
| `multi-court-conflict-TODO.md` gap | `src/server/api/routers/calendar.ts` | Multi-court events only check `resourceId`, not `resourceIds` |
| Gender required drop-in gate | `src/server/services/dropIn/` | G7 unenforced; `joinQueue` has no onboarding check |
| `getCoachDashboardMetrics` cleanup | `src/server/api/routers/user.ts` | Still flagged in `nextSteps.md` |
| Video collection DB queries in page component | `src/app/(app)/video-collections/` | Should use paginated tRPC endpoints |
| `noLabelWithoutControl` a11y warnings | `src/app/(app)/profile/page.tsx`, `ClientsList.tsx` | Pre-existing; do a broader a11y pass |
