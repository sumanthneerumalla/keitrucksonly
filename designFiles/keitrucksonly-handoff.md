# KeiTrucksOnly: session handoff (2026-10-31)

## What this repo is
This is the ShuttleMentor codebase (Next.js, tRPC, Prisma, Clerk, Stripe Connect, clubs), kept with its history. It is being turned into **keitrucksonly.com**, a free kei truck listings aggregator. All work so far is on branch `claude/cool-dirac-hs1ezq`.

## Docs to read first (in `designFiles/`)
- `keitrucksonly-strategy.md`: landscape research, pre-mortem, niche, agent operating model, and how ShuttleMentor models map to the new product.
- `keitrucksonly-gtm-playbook.md`: week-by-week go-to-market plan, dealer outreach email template, Reddit mod message, decision scorecard for Feb 2027.
- `dealer-ranking.md`: merged ranking of the largest dealers and the v0 seed set.
- `dealer-prospects.csv`: 54 dealers with listing counts, site platform, ingest method and contacts.
- `dealer-sales-evidence.md`: sales-volume estimates with sources.

## Decisions made
- **Positioning:** "Every kei truck for sale in the US, filtered to the ones you can actually register in your state." Free listings, every listing links out to the dealer, no commission, no payment handling (this keeps the site outside dealer-licensing rules).
- **v0 scope:**
  - Dealer inventory ingest.
  - Search with a per-listing "can I register it in my state?" filter (truck year + a `StateRule` table with source links and a "last verified" date).
  - Saved-search email alerts that need only an email address (no accounts).
  - 50-state law pages.
  - A price index page that computes itself from listing data.
  - Dealer "claim or remove listing".
  - Listings hidden automatically when not seen for 72 hours.
  - An automated weekly health email to the owner.
- **Out of v0:** user accounts, private sellers, payments, forum, regular articles, agent automation.
- **Owner constraint:** v0 must be very low effort to build, maintain and run. The owner checks in occasionally and is fine letting it sit after launch. **No agents and no scrapers yet.**
- **Ingest approach for later:** generic adapters, not per-site scrapers.
  - Shopify `/products.json`, filtered on `variants.available`.
  - The public WooCommerce Store API.
  - Vehicle/product data embedded in pages (JSON-LD), and sitemaps.
  - That covers 12 seed dealers, about 300–500 listings.
- **New dealers need vetting before going live:** domain age, phone area code vs. address, payment terms, Google Maps / BBB presence.

## Open decisions (ask the owner)
1. **Hosting:** keep the self-hosted setup (Caddy, ddclient, pgbackrest, crontab in `serverFiles/`), or move to managed hosting with managed Postgres and a scheduler?
2. **Leftover ShuttleMentor features:** remove them from the working tree in one labelled commit (history keeps them), or leave them in place?

## Competitors
- **Oiwa Garage / KeiTruckUS.com:** a parts retailer in Long Beach that also sells some trucks. Its site lists 402 trucks from 18 dealers, has a 50-state law map, price trends, a 25-year-rule checker and a landed-cost calculator, and funnels visitors to its parts store. It does **not** have: a per-buyer-state registration filter, saved-search alerts, or links out to dealers. It also isn't neutral.
- **JDMBuySell:** domain registered in 2005, about 1,000 kei listings, free listings, paid boosts ($49–299), dominates programmatic SEO, uses Brevo and Postmark for email.

## Red flag
keitruckdirect.com claims 949 trucks but shows fake-dealer signs:
- domain registered 2026-07-13
- a Goshen NY address next to a real dealer, but a Utah (385) phone number
- bank wire only, payment described as non-refundable
- no named owner

Excluded from everything.

## Domains
- keitrucksonly.com is owned.
- **ktrucksonly.com is unregistered.** Buy it and redirect it to keitrucksonly.com.

## The Browser Farm (the owner's product; use it to dogfood)
- Cloud Chromium with a Browserbase-compatible API. Base URL `https://api.thebrowserfarm.com`.
- Auth header: `X-BB-API-Key` or `Authorization: Bearer`.
- **Getting a key (device flow):**
  1. `POST https://www.thebrowserfarm.com/api/device/code` returns `{device_code, user_code, verification_uri:"/device", interval:5, expires_in:600}`. Use **www.** — the bare domain sends a 301 that breaks POST.
  2. The owner approves at `https://www.thebrowserfarm.com/device?code=<user_code>`.
  3. Poll `POST /api/device/poll` with `{"device_code": "..."}` every 5 seconds. It returns `{"status":"pending"}` until approved, then the key (`bf_live_…`) exactly once.
  4. Save the key to `~/.config/browserfarm/credentials` (chmod 600) as `BROWSERFARM_API_KEY=…`. Never print it and never commit it.
- **Using it:**
  - Create a session: `POST /v1/sessions` with `{}` returns `connectUrl`.
  - Connect with `chromium.connectOverCDP(connectUrl)`.
  - Release: `POST /v1/sessions/{id}` with `{"status":"REQUEST_RELEASE"}`.
- **Limits:** residential egress is not live yet, so Reddit and Facebook may still block it.
- The key minted in the cloud session (prefix `bf_live_7rGk`) was not carried over. The owner can revoke it at `/keys`.

## Next tasks
1. **(Pending owner OK)** Gap-fill research with The Browser Farm:
   - live inventory at Northwest Mini Trucks (WA, 161–218 listings) and Mayberry (NC; its site loads listings from api.mayberryminitrucks.com)
   - Weatherford Mini Trucks (TX, a JavaScript-rendered Base44 site)
   - Google Trends for "kei truck" vs "mini truck" vs "k truck"
   - Facebook dealer pages and group sizes
2. **Week 0 from the playbook:**
   - Register ktrucksonly.com.
   - Build a "coming soon" page on keitrucksonly.com with email capture (email, state, model of interest).
   - Rename the project from ShuttleMentor (package.json, README).
3. Once hosting and cleanup are decided: build the v0 data model (`Dealer` reusing `Club`, `Listing`, `StateRule`, `SavedSearch`) and the registration filter.
