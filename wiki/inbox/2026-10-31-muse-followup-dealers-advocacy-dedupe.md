---
date: 2026-10-31
source: agent:muse (Meta AI, owner's connected FB account), relayed by owner
---
Follow-up answers to items 2–5. Item 1 (synonym/chassis CSV) was not included in the paste; pending.

## Dealers (→ [[dealers]])
- CORRECTION: Lancaster Mini Truck HAS a website: lancominitruck.com (Denver, PA area). 12 vehicles at crawl, ~7–8 kei. Press Oct 18–19 2026: imports ~15–20 trucks/month, typically sells $6k–$8k, PA titles, FAQ cites PA antique registration. Not found under that name on Marketplace. ([[lancaster-mini-truck]], [[open-questions]])
- Lancaster's inventory statuses are a good status enum: Title Here / Title Pending (~4–6 weeks) / Coming Soon / Sold-On Deposit.
- Facebook-active businesses not in our CSV (count = trucks in the 306-truck Oct 31 sample): Tiny Japan Motors, Federal Way WA (5); Midwest Auto, Troy OH (3); Catskill Auto, Walton NY (3–4); Ondori Garage, York PA (2, Scrums).
- CONFLICT: Kuruma Imports location — Muse saw Palm Bay, FL in listing text; dealer-ranking.md says Miami, FL.
- Motorcycle Warehouse (OR) also uses minitruckwarehouse.com (we had mc-warehouse.com); notes kei trucks can't be street-registered in OR but can be in WA, ID, AZ.
- Mini Trucks Ohio sells new 2022–2023 S510P (new off-road market); FB activity unverified.
- ATL-JDM (Cumming, GA): directory listing only.
- TN and NC Facebook volume comes from personal-profile dealers (largest seller: 12 trucks, Kannapolis NC; TN: 5 from one Cookeville seller). Product signal: "personal profile with 3+ active kei listings in 30 days" = dealer-equivalent. Never publish personal names.
- GA 5 trucks/5 sellers; OR 8/8; CO 5, no business dealer; ME 2.

## Advocacy groups (→ [[distribution]], [[state-laws]])
- Lone Star Kei (TX) 748, private: no promotions, no cross-posting, no TxDMV workaround talk; member sales 1/day in a strict format. Texas Kei Truck Advocates = older name for the TX effort; treat Lone Star Kei as current.
- Michigan Kei Advocates: no named group found. MI backed down late 2024 and resumed on-road titles after an owner challenge.
- Empire State Kei Advocates (NY): exists per Oct 2026 press; FB group not found (maybe private/hidden).
- Massachusetts JDM Imports Advocates 987, private (created 2024-06-17): advocacy only, no selling.
- JDM Oregon Advocates: exists per May 2025 article; FB group not found.
- Consumer JDM Advocacy Association (national) 847, public.
- Wisconsin Japanese kei trucks 383, public: no self-promotion. WI DOT began enforcing statute 341.10(6) late 2025, denying new registrations.
- Colorado Kei Trucks/Vans 700, public: local sales OK, no dealer spam.
- CONFLICT: Colorado HB25-1281 effective date — strategy doc says 2027-07-01; Muse cites one source putting the registration window at 2028-01-01. Verify. ([[state-laws]])
- GA: HB 308 passed both chambers 2025, vetoed May 2025 (in addition to HB 957 dying 2026). PA: HB 1205 (Jan 2025) would allow mini trucks on roads ≤55 mph. RI: revocations since 2021, proposed law to formalise ban. IL: revocations reported from Apr 2025. No named advocacy FB groups found for RI/GA/PA/IL.

## Dedupe (→ [[ingest]], [[data-model]])
- Marketplace search overlap: 1,105 hits → 699 unique (36.7% repeats from overlapping radii). Count unique listings, not hits.
- Group cross-posting: Kei Truck Owners vs Kei Trucks and Vans top-20: 5 identical posts (25%). Same content, DIFFERENT post IDs: dedupe on content hash, not post ID.
- Estimate: dealer trucks appear in 2+ places 30–50%, private 10–20%, overall 20–30%.
- Dedupe signals ranked: VIN/chassis number (ignore placeholders like repeated 1s) > first-photo perceptual hash (FB strips EXIF) > year+model+chassis code+price+city > normalised mileage+drivetrain+trim+body > dealer stock number/status > description fingerprint (first 200 chars, lowercased, punctuation stripped) > seller ID (supporting only).
- Never dedupe on title alone, price alone, or seller name.

## Sold behaviour (→ [[kpis]], [[data-model]])
- FB snapshot: 699/699 listings "Available", 0 sold/pending. Time-to-sell can't be measured from one snapshot.
- Listing age median 10 days, p75 18, max 31: search results are censored at ~31 days. No price-drop pattern visible.
- External benchmark (JDM aggregator sold pools, 24 months, not FB): listing-to-sold median Acty 91–93 days (n≈125), Hijet S200 50 days (n=20), Carry 36 days (n=31).
- To measure: poll listing IDs / content hashes daily for 90 days; record first-seen, last-seen, price changes, status edits. Dealer sites are where sold status actually exists.
- Estimate: $6k–$8.5k 1990s 4WD with A/C and clean title in FL/TX/WA move fastest; $12k+, vans, supercharged Sambars, dumps in restricted states sit longer.
