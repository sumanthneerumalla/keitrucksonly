# KeiTrucksOnly: session handoff (2026-10-31)

> Living project context (decisions, dealers, laws, open questions) is in `wiki/`; start at `wiki/index.md`.

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

## Decided by owner (2026-10-31)
1. **Hosting: self-hosted.** Keep the `serverFiles/` setup (Caddy, ddclient, pgbackrest, crontab).
2. **Leftover ShuttleMentor features: leave in place.** Build alongside them; no cleanup commit.

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
1. ~~Gap-fill research with The Browser Farm~~ **Done 2026-10-31.** See below and `keitrucksonly-research-2026-10-31/`. The owner asked for research only, no code, in this session.
2. **Week 0 from the playbook:**
   - Register ktrucksonly.com.
   - Build a "coming soon" page on keitrucksonly.com with email capture (email, state, model of interest).
   - Rename the project from ShuttleMentor (package.json, README).
3. Hosting and cleanup are decided, so next: build the v0 data model (`Dealer` reusing `Club`, `Listing`, `StateRule`, `SavedSearch`) and the registration filter.

## Gap-fill research results (2026-10-31)
Full notes are in `keitrucksonly-research-2026-10-31/` (`dealers.md`, `trends.md`, `facebook.md`, `gap-states.md`). Seven gap-state dealers were appended to `dealer-prospects.csv`.

- **Dealer feeds (all public, no red flags):**
  - Mayberry: 65 units from one unauthenticated JSON endpoint (`api.mayberryminitrucks.com/inventory/getInventoryMetaData`).
  - Northwest Mini Trucks: 210 units, about 147 of them kei trucks. Custom Rails site; ingest via `sitemap.xml` plus the structured data on each vehicle page.
  - Weatherford: 31 live units from a public Base44 function. Most are **new off-road-only** Hijets and Carrys.
  - **Implication:** `Listing` needs a street-legal (25+ yr import) vs. off-road-new flag.
- **Data model:** some operators run several locations (JDM Car & Motorcycle in WA and TN), so `Dealer` needs multiple locations.
- **Gap states:** GA, OR and ME refuse to title kei trucks, which is why there are few dealers there. Listings in those states need an "off-road only here" flag.
- **Colorado dealers aren't ready for 2027:** the two found mostly sell new units, which won't qualify for the 25+ yr registration.
- **Search terms (Google Trends, US):**
  - "kei truck" is up about 10x since 2021.
  - "kei truck for sale" is about 0.85x of "mini truck for sale" and closing.
  - "Mini truck" is noisy (food trucks, toys).
  - Peaks are December and April–June.
  - Top states by share: HI, UT, WA, ID, VT, NH, AK, CO.
  - Use "kei truck" as the head term and "mini truck" as secondary wording (the South and Midwest say "mini truck").
- **Distribution:**
  - Largest groups: Mini Truck Marketplace (151K, public), Japanese Mini Trucks For Sale (75K), Kei Truck Owners (58K; promotions need admin approval), Kei Truck Club (52K; promotions OK).
  - Oiwa owns "Japanese Mini Trucks of America For Sale!" (56K) and charges dealers to list.
  - r/keitruck: about 37K weekly visitors, vendor flair required, strong anti-Oiwa sentiment (a pinned post).
  - PNW Kei bans dealer ads, so pitch "free, no dealer fees".
  - The state advocacy groups weren't found.
- **Browser Farm dogfood notes:**
  - Google Trends: the cold load returned 429; warming up cookies and retrying after 60 s worked. Classic Explore is being retired.
  - Facebook logged out: `/groups/<id>/about` works even for private groups; bare `/groups/<id>/` hits a login wall after about 6 parallel loads.
  - Search: Brave `site:` search showed a CAPTCHA after about 18 queries (not bypassed). Bing ignores `site:`.
  - old.reddit requires login.
