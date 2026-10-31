---
date: 2026-10-31
source: agent:listing-sampler
---
Sampled ONE live kei listing from each dealer in designFiles/dealer-prospects.csv. Full detail in designFiles/keitrucksonly-research-2026-10-31/field-inventory.md. Raw payloads and samples.jsonl are in the session scratchpad, which is not in the repo.

## Coverage
- 51 listings sampled: 50 CSV dealers plus Northwest Mini Trucks as a bonus. 11 of 61 CSV rows could not be sampled. (2026-10-31, field-inventory.md §7)
- Unit mix: about 36 are 25+ year imports (2001 or older), 4 are 2002–2006 units at Canadian dealers, and about 5 are new 2021–2026 off-road units. (2026-10-31, samples.jsonl)

## Which attributes dealers expose
- Most reliably structured fields (API/JSON-LD or page spec table, out of 51): photos 51, price 48, mileage value 35, transmission 34, colour 33, drive 31, make 31, status 31 (shallow), stock # 30, currency 29. (2026-10-31, field-inventory.md §1)
- Rarely structured but high value for search: (2026-10-31, field-inventory.md §1, §4)
  - hi/lo or extra-low gear: 4
  - diff lock: 3
  - kei body type: 11
  - title status: 9
  - legal class: 4
  - build month: 4
  - mileage unit explicit: 7
- Chassis code is a separate field at only 7 dealers, but it is derivable from the frame number in 25 of 51 listings. Normalise frame numbers to {chassis_code, serial}; they appear in 5+ formats (hyphen, no hyphen, 17-char zero-padded, masked, truncated). Never treat them as a 17-digit VIN. (2026-10-31, field-inventory.md §3)
- Odometer units: km only 8, mi only 14, both 20, neither 9. Store the original value and unit plus a converted value. (2026-10-31, field-inventory.md §1)

## Data traps
- "Price" fields that hold something else: (2026-10-31, field-inventory.md §3)
  - Rocky Mountain's price is a $500 refundable deposit.
  - Superior's JSON-LD price is 0.
  - Japan Direct sold items show 0.
  - The Woo Store API returns prices in cents.
  - Regular vs sale/cash prices appear at 3 dealers.
- Bad structured data:
  - The Mars JSON-LD describes a different vehicle (a Toyota Estima). (2026-10-31, raw mars listing)
  - G&R's brand is wrong.
  - Duncan pads its VIN field.
  - schema `itemCondition` is New on 1990s trucks.
  - Don't trust JSON-LD blindly.
- Status is mostly not structured. Arriving and sold live in ribbons, title prefixes and categories. AZ has one product in Available + En-Route + Sold at once. (2026-10-31, field-inventory.md §3)

## Ingest
- Only 3 of 51 strictly needed a real browser: Duncan and JDM Offroad (curl gets 403) and buykeitrucks.ca (client-rendered). Shopify (6), Woo (5), dealer APIs (2), Squarespace JSON (1) and JSON-LD (about 16) cover about 30 dealers. (2026-10-31, field-inventory.md §6)
- No per-unit URL at JMT Ohio (paragraphs on a page) or Weatherford (cards → contact form). These need synthetic IDs. US Mini Truck Sales and Mini Trucks Ohio reuse slugs for different trucks. (2026-10-31, site-patterns.md)
- QUESTION for [[open-questions]]: should Canadian dealers (CAD prices, 15-year rule units) be in v0 or filtered out?
