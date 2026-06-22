# Clover POS — Semi-Integrated MVP

Status: **Design / synthesis** (no code yet). Source of truth for the Clover
integration scope. Mirrors the conventions of the existing payments work
(`designFiles/payments/`, `src/server/services/payments/`).

Working branch for implementation: `claude/clover-pos-integration-lTM2q`.

---

## 1. Goal

Integrate Clover POS so in-person sales stay in sync with FacilityPresence (FP),
and so a **front-desk computer running FP can initiate a card charge that pops up
ready-to-pay on a physical Clover terminal**.

- **FP is the source of truth for everything**: catalog, pricing, tax, customers,
  invoices, memberships, packages.
- **Clover is the card reader + the in-person sales record** — not a parallel
  system of record.

---

## 2. Integration model decision: SEMI-INTEGRATION

Clover offers two ways your software and the hardware work together:

- **Native (fully integrated / on-device Android app):** your code runs *on* the
  Clover device; the terminal *is* the register.
- **Semi-integrated:** your own software (FP) runs *elsewhere* and drives the
  Clover device just for the payment step; the terminal is a card reader.

**Decision: semi-integration only.** Native is a **non-goal** for now.

In both models, Clover handles the actual card data (we never touch raw card
numbers). The difference is purely where the brain of the sale lives — for us,
that's FP.

### Native revisit trigger (product-driven, not technical)

Build native only if/when we need to **sell where there is no computer** — e.g. a
roaming Clover Flex carried court-side at a tournament, or a second sales point
(café) with no FP computer. Until someone asks for that, native stays off the
roadmap. A future native app rides under the **same single Clover app
registration**; it is not a separate Clover app.

### Things that do NOT require native (so we don't over-invest)

- **Inventory/catalog sync** — pure server-to-server REST/webhooks.
- **Ad hoc sales** — Clover's built-in register does these natively and syncs back
  via webhook; FP can also ring them up semi-integrated.
- **Barcode scanning** — a USB/Bluetooth **keyboard-wedge** scanner plugged into
  the front-desk computer "types" the barcode into an FP register-screen SKU field.
  FP looks up its own `Product.sku` (FP is source of truth, so no Clover dependency
  for the lookup) and adds to cart. No native, no Clover scanner.
- **Member attribution, reporting, refunds-from-FP** — all reachable server-side.

---

## 3. Clover app registration

- **One private Clover app**, multi-type registration, **not published** to the App
  Market. Clubs install via the OAuth link
  `https://www.clover.com/oauth/authorize?client_id={APPID}`.
- ⚠️ **Webhooks require Clover app approval even for private apps** (can take
  several weeks). Start the approval clock early; develop against the sandbox
  merchant in parallel.
- **One Clover merchant per club**, 1:1 — mirrors the existing `ClubStripeAccount`
  pattern.

---

## 4. The three buildable chunks

### Chunk A — FP-initiated charge via Cloud Pay Display (the headline flow)

This maps almost 1:1 onto the existing Stripe Embedded Checkout flow. Clover
becomes another *payment surface*; all entity linking stays server-side in FP.

**Existing Stripe shape** (`dispatch.ts` + `sellMembershipInternal`):
1. FP builds a fully-linked `CheckoutIntent` (itemKind, beneficiary/consumer,
   payer/billedTo, `correlationId`, `checkoutSessionId`) + open `CheckoutSession`.
2. Hands the charge to Stripe Embedded Checkout with `metadata.checkoutSessionId`.
3. Card runs; webhook fires with that metadata.
4. `dispatch.ts` attaches the `InvoicePayment` to the linked invoice and closes it.

**Clover version** — swap only step 2's surface ("browser checkout" → "physical
terminal"):
1. FP calls the **same `sellMembershipInternal` / `sellPackageInternal`** (consumer
   + billedTo) → fully-linked invoice, left **open/unpaid**. Generate
   `externalId = correlationId`.
2. FP sends a **Sale(amount, externalId)** to the club's Clover device via
   **Cloud Pay Display**.
3. Customer taps card; **EMV runs on Clover hardware**.
4. Result returns; FP looks up the open invoice by `correlationId`, records the
   `InvoicePayment` (`processor: "clover"`, `processorTransactionId` = Clover
   payment id), closes the invoice. This is essentially the existing `dispatch.ts`
   `case "invoice"` path with `processor: "clover"`.

**The linking key — `externalId`:** Clover lets the POS stamp its own ID onto a
device payment (`externalPaymentId` / `setExternalId`), also used for duplicate
prevention. That ID **is** our `correlationId`. Clover never needs to know about
beneficiary-vs-payer; it only sees an amount + our ID. So all two-identity
("sold to A, billed to B") logic stays in FP, unchanged.

### Chunk B — Reconciliation / sales-pull (webhooks + REST)

In-person Clover orders/payments (including ones rung up on Clover's own register)
become FP invoices + payments for unified revenue reporting. Refunds sync back.

- New webhook route `src/app/api/webhooks/clover` mirroring
  `src/app/api/webhooks/stripe/platform/route.ts` + `_shared.ts`.
- Reuse `ProcessedProcessorEvent` (composite PK `(processor, eventId)`) for
  idempotency and `OrphanedPurchase` for anything unreconcilable.
- Map Clover line items → `RevenueCategory` / `Product`; write `Invoice` +
  `InvoicePayment` via `recordPaymentInternal` / `getOrCreateOpenInvoice`.

### Chunk C — Front-desk register UI in FP (net-new)

FP today has invoices, billing, and sell-membership/package flows, but **not a fast
cashier screen**. Build a lightweight register UI: pick member-or-walk-in → add
items / membership / package / drop-in → **"Collect on terminal."** The browser
calls FP's own API and polls FP for status; it does **not** hold the Clover
connection.

### Also: FP → Clover catalog push (REST)

Push FP products/prices/tax up to the register; deactivating a product in FP
removes it from the register. Hook into `products.*` mutations + a one-time
backfill. Add a `cloverItemId` column on `Product` (alongside the existing
`stripeProductId` / `stripePriceId`).

---

## 5. Connection model

Pay Display is a **persistent WebSocket** connection. Two transports:

- **Cloud Pay Display** — FP talks to Clover's cloud, which relays to the device.
  Device only needs internet. Works even though FP is hosted off-site.
- **LAN / Secure Network Pay Display** — POS and device on the same local network;
  lower latency but unreachable from a cloud-hosted FP server.

**Decision: Cloud Pay Display, driven from the FP SERVER** (not the browser). The
FP backend holds the WebSocket connection + OAuth token; the front-desk browser
calls FP's own API and watches FP for status. This keeps secrets server-side,
survives a browser refresh, and lets the webhook be the safety net. Device-side
prerequisite: the **Cloud Pay Display** app must be installed and open on the
terminal.

(Confirm FP's hosting can reach Clover's cloud; fall back to LAN only if required.)

---

## 6. Reliability design (critical)

The **lost-confirmation problem**: the customer can be charged while the response
never reaches FP (desk PC sleeps, network blip, FP restart). Design for it:

- Treat completion as arriving from **two channels**: the synchronous Pay Display
  response **and** the Clover `payment` webhook.
- Backstop both with **`getPaymentByExternalPaymentId`** polling.
- Make the attach **idempotent by `externalId`**.
- Use a **fresh `externalId` per attempt** (a retry after a decline must not
  collide with the failed one — Clover rejects duplicate external IDs).
- Route anything unreconcilable into the existing **`OrphanedPurchase`**
  dead-letter queue.

### Transaction lifecycle (not fire-and-forget)

The front-desk screen must reflect real terminal states: *waiting for card →
presented → approved / declined / canceled / timed out / device busy-or-offline*.

- **Cancel-from-POS** — staff need a cancel button when the customer changes their
  mind mid-tap (Pay Display supports it).
- **Tips & signature prompts OFF** in the sale request (pro-shop context).

---

## 7. Money, tax, receipts

- **Two money rails.** Clover funds settle to the **club's Clover merchant
  account** on Clover's rates/payout schedule, independent of Stripe. FP unifies
  the *record* of sales, not the *money*. A club will have two payout streams + two
  fee schedules + two statements. Capture Clover's per-payment fee (like the
  existing `processorFeeInCents`) so reporting stays honest.
- **Tax.** FP computes the total **including tax** and sends ONE amount; ensure the
  Clover device/merchant does not add its own tax on top.
- **Refunds.** Initiate FP → Clover. Handle the **void** (same-day, pre-batch
  settlement) vs **refund** (post-settlement) distinction; mirror back like the
  Stripe refund sync (`recordRefundInternal`).
- **Receipts.** Clover prints the card slip; FP sends the business invoice. Decide
  FP owns the business receipt.

---

## 8. Identity / customers

FP owns user creation, so this is lower-priority, but for synced Clover-native
sales:

- A counter sale with a Clover customer attached → auto-create or match an FP user
  by **email** (mirror the Stripe guest path in `dispatch.ts`). Email is the dedup
  key, so a person who bought online (Stripe) and at the counter (Clover) collapses
  into one `User`.
- A sale with no customer → generic **walk-in** invoice; no junk user.
- Clover cannot supply **gender** (no native field) and can't guarantee email/DOB;
  `User.gender` is nullable but "required at onboarding / set-once" — confirm no FP
  flow assumes it's non-null for these stub/guest users.

---

## 9. Reuse map (existing code)

Stack: Next.js 15, tRPC 11, Prisma 6, Clerk, Postgres, Tailwind, Biome, Vitest.

- `src/server/services/payments/types.ts` — `PaymentProvider`,
  `ProcessorName = "stripe" | "paysafe" | "valor"` → **add `"clover"`**;
  `CheckoutIntent`, `ParsedProviderEvent`, error classes.
- `src/server/services/payments/index.ts` — `getProviderForClub` resolver; extend
  to resolve a Clover provider from `ClubCloverAccount`.
- `src/server/services/payments/dispatch.ts` — webhook dispatch; `case "invoice"`
  is the closest analog; two-identity (`billedToUserId`) logic lives here.
- `src/server/services/payments/stripe.ts` / `stripeWebhook.ts` / `failure.ts` —
  provider impl, webhook handler, orphan handling.
- `src/server/utils/invoicePayments.ts` — `recordPaymentInternal`,
  `recordRefundInternal`.
- `src/server/utils/invoiceTab.ts` — `getOrCreateOpenInvoice`.
- `src/server/utils/sellMembership.ts`, `sellPackage.ts` — build linked invoices.
- `src/app/api/webhooks/stripe/platform/route.ts` + `_shared.ts` — route pattern;
  add `src/app/api/webhooks/clover`.
- Prisma models: `Invoice`, `InvoiceLineItem`, `InvoicePayment`, `InvoiceRefund`,
  `Product` (has `sku`, `stripeProductId`, `stripePriceId` → add `cloverItemId`),
  `ProductCategory`, `RevenueCategory`, `TaxRate`, `ClubStripeAccount` (mirror as
  `ClubCloverAccount`), `ProcessedProcessorEvent`, `OrphanedPurchase`,
  `ProcessorCustomerLink`, `CheckoutSession`.
- **SDK fence:** `package.json` `check-stripe-fence` restricts the Stripe import to
  `stripe.ts`. Apply the same discipline — keep any Clover SDK import fenced to a
  single `clover.ts` and add an analogous fence check.

Commands: `npm run typecheck`, `npm run check` (Biome), `npm run test` (Vitest),
`npm run db:generate` (prisma migrate dev).

---

## 10. Open decisions to resolve before/while building

- OAuth token storage + encryption at rest for `ClubCloverAccount` — how does
  `ClubStripeAccount` handle secrets today (env vs DB)?
- Multi-terminal: a club may have >1 Clover device; design device pairing/selection.
- Receipts ownership (FP business receipt vs Clover card slip).
- Whether any FP flow assumes `User.gender` is non-null (matters for synced/guest
  users).
- LAN vs Cloud final confirmation given FP's hosting/network.

---

## 11. Suggested first steps

1. Read the existing payments abstraction + schema models (Reuse map, §9).
2. Schema: add `ClubCloverAccount`, `cloverItemId` on `Product`, `"clover"` to
   `ProcessorName`; generate a migration.
3. Scaffold: OAuth callback route, `/api/webhooks/clover` route, a fenced
   `src/server/services/payments/clover.ts`, and a server-side Cloud Pay Display
   client. Wire reconciliation into the dispatch pattern.
4. Build the front-desk register UI (Chunk C).
5. Resolve the open decisions (§10) with the product owner.

---

## 12. Reference documentation

### Accounts, app setup, environments
- https://docs.clover.com/dev/docs/gdp-create-global-developer-account
- https://docs.clover.com/dev/docs/create-a-sandbox-account
- https://docs.clover.com/dev/docs/developer-accounts
- https://docs.clover.com/dev/docs/gdp-create-new-app
- https://docs.clover.com/dev/docs/gdp-manage-app-settings
- https://docs.clover.com/dev/docs/private-apps
- https://docs.clover.com/dev/docs/clover-environments
- Dashboards: https://www.clover.com/global-developer-home/home ·
  https://sandbox.dev.clover.com/developers/signin

### REST API + OAuth + webhooks (sales pull / catalog push)
- https://docs.clover.com/dev/docs/clover-development-basics-web-app
- https://docs.clover.com/dev/docs/making-rest-api-calls
- https://docs.clover.com/dev/docs/webhooks
- https://docs.clover.com/dev/reference/api-reference-overview
- https://docs.clover.com/dev/docs/clover-rest-api-index

### Semi-integration / Pay Display (FP-initiated charge) — PRIMARY
- Overview & choices: https://docs.clover.com/dev/docs/paas-integration-options
- Basics: https://docs.clover.com/dev/docs/clover-development-basics-semi
- FAQs: https://docs.clover.com/dev/docs/payments-semi-integration-faqs
- Glossary: https://docs.clover.com/dev/docs/semi-integration-glossary
- Listener app on device: https://docs.clover.com/dev/docs/pay-display-apps
- REST Pay Display API (lightest; raw REST/WebSocket):
  - https://docs.clover.com/dev/docs/rest-pay-intro
  - https://docs.clover.com/dev/docs/rest-pay-connection
  - https://docs.clover.com/dev/docs/api-tutorials
  - https://docs.clover.com/dev/docs/configuring-secure-network-pay-display (LAN)
- Cloud Connector JS SDK (alternative to raw REST):
  - https://docs.clover.com/dev/docs/cloud-sdk-v3
  - https://github.com/clover/remote-pay-cloud
  - https://github.com/clover/codelab-remote-pay-cloud
  - https://clover.github.io/remote-pay-cloud/4.0.3/
  - https://www.npmjs.com/package/remote-pay-cloud

### External ID + reconciling the result
- https://docs.clover.com/clover-platform/docs/what-is-external-payment-id
- https://docs.clover.com/dev/reference/get_payment_by_external_payment_id
- https://docs.clover.com/dev/docs/payment-response-reference

### Native / on-device (DEFERRED — reference only)
- https://docs.clover.com/dev/docs/take-a-payment-with-payment-connector
- https://docs.clover.com/dev/docs/android-payments-api-payment-tutorial
- https://docs.clover.com/dev/docs/developer-pay-api
