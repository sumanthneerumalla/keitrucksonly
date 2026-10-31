---
date: 2026-10-31
source: agent:listing-sampler
---
Walked every reachable dealer site like a buyer (home → inventory → one listing) in The Browser Farm: 130 sessions, all released. Full per-dealer notes are in designFiles/keitrucksonly-research-2026-10-31/site-patterns.md. Screenshots are in the session scratchpad (listings/raw/<slug>/), which is not in the repo.

## Platforms and schema
- Platforms across 51 sampled dealers: Shopify 7, WooCommerce/WordPress about 12, Wix 6, dealerwebsites.com template 4 (Fun Karz, Northeast, Mud Hog, Kuruma), Carsforsale 2, Squarespace 2, plus single custom stacks. Mini Trucks Ohio, Mile High and US Mini Truck Sales share one WordPress "minitruck" plugin vendor. (2026-10-31, site-patterns.md)
- The title is the spec sheet. Structured fields, where present, are a subset of the title tokens (e.g. "4WD, 2Hi-4Hi-4Lo, PS, AC, 5MT"). Generic car templates hide the kei body behind "Body Style: Pickup". (2026-10-31, site-patterns.md)

## Status, legality, contact
- Status lifecycle: Available / Arriving (en route, incoming, in transit, coming soon) / Pending / Sold. It is expressed as separate pages, ribbons, title prefixes or categories, not as fields. About 14 sites keep public sold archives, which are useful for price comps. (2026-10-31, site-patterns.md)
- Arriving stock is pre-sold: Skyline (ship name + ETA), Weatherford ("Expected" date), Rocky Mountain ($500 deposit), Granite ("INCOMING NOVEMBER 2026"). (2026-10-31, site-patterns.md)
- Two markets on the same sites: 25+ yr imports vs new off-road units. Weatherford's nav split ("Off Road Mini Trucks" vs "25+ Year Trucks") and its card badges (status · legal lane · body) are the cleanest UX found. (2026-10-31, weatherfordminitrucks.com)
- Contact flow: about 85% use an inquiry form plus phone/text. Deposit or reserve flows at Rocky Mountain, Dyna ($1,000), B-Pro, Skyline, Mile High and Dakota. Cart checkout on vehicles at Krazy Kei, JPM, G&R and minitrucks.net. Weatherford's form asks the intended use. (2026-10-31, site-patterns.md)

## UX to copy
- Boeki's feature-chip checklist (active/inactive: 4WD, LO/HI, Diff Lock, EL, UL, PTO, PS…) plus its condition grade legend ("4/B"). (2026-10-31, boekiusa.com)
- Dyna's translated auction sheet. JPN's "Manufactured March 1999" plus auction grade 3.5. (2026-10-31, dynamotorimports.com, jpnautoimport.com)
- Mini Monsters' ZIP shipping estimator and its explicit "This vehicle is not street legal". (2026-10-31, minimonstersusa.com)
- Parts stores organise by chassis code (JMT, West Shore), which is evidence that chassis code is the community's real taxonomy. (2026-10-31, minitruckheadquarters.com, minitruck.ca)

## Dealer facts for dealer pages
- CORRECTION/UPDATE for dealer pages:
  - Arizona Kei Trucks had 0 available kei trucks on 2026-10-31; only en-route kei units were listed. (azkeitrucks.com/available)
  - Weatherford's 25+ yr units are all arriving_soon. (weatherfordminitrucks.com/imports)
  - SODO Moto had no kei in stock. (sodo-moto.com/in-stock-2)
  - Mini Trucks South is still HTTP 500. (minitruckssouth.com)
  - JPN Auto Import showed no Cloudflare challenge, although the CSV says there is one. (jpnautoimport.com)
- Affiliations: Street Legal Mini Trucks = Japstar Imports (same CMS and copy) (2026-10-31, both sites). Boeki WA shares phone 360-990-7770 with Northwest Mini Trucks (2026-10-31, dealers.md + boekiusa.com).

## Browser Farm feedback (owner dogfooding)
- Sessions: create median 474 ms (max 2.8 s), CDP connect median 492 ms (max 4.9 s), 130/130 released.
- Blockers:
  - Cloudflare "Just a moment" 403 on samuraitrucks.com/kei-trucks/ (other pages on that site fine).
  - Facebook shows a closable login popup on every logged-out load; content is readable but screenshots are useless.
- Tooling bug, ours: Playwright `response.body()` never resolves for streaming or long-poll fetches. Awaiting it in `finally` hung one run for 12 minutes. Fixed with a 10 s per-body timeout in listings/tools/bfwalk.mjs. Worth documenting for Browser Farm users.
- Not BF issues: Duncan and JDM Offroad block curl (403) but render fine in BF, so BF earns its keep there. jdmdrive.com has an invalid TLS cert.
