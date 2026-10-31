---
title: Weatherford Mini Trucks
type: dealer
tags: [dealer, state/TX, ingest/json-api]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-research-2026-10-31/dealers.md, designFiles/dealer-ranking.md]
---
**Summary:** Weatherford TX; mostly new off-road-only Hijets; public Base44 function gives the inventory. Part of [[dealers]].

- Location: 1015 Fort Worth Highway, Weatherford TX 76086; (682) 332-6992; weatherfordminitrucks@gmail.com. (2026-10-31, dealers.md)
- Inventory: 83 records, 31 live (8 available, 5 reserved, 18 arriving_soon), 52 sold. 74 in lane `off_road_new`, 9 in `street_legal_25_plus`. (2026-10-31, dealers.md)
- Live units are mostly new 2025/2026 Daihatsu Hijets and 2025 Suzuki Carry ($24,500-$30,995), sold off-road only. Street-legal lane: 1996-2001 trucks at $8,500-$14,995. (2026-10-31, dealers.md)
- Ingest: `POST https://weatherfordminitrucks.com/api/apps/698be11b118f14d14ebf9641/functions/getPublicTrucks` with `{}`; filter `status != sold`. Use the function, not the raw entity endpoint; don't test write endpoints. (2026-10-31, dealers.md)
- Data quality: messy model names, free-text mileage, placeholder 2027-01-01 arrival dates. (2026-10-31, dealers.md)
- Payment: LightStream financing (from 6.49% APR), shipping quoted per trip, no wire-only language. (2026-10-31, dealers.md)
- Vetting: domain registered 2012-10-15 (site rebuilt 2026); 682 area code matches. No hard red flags. (2026-10-31, dealers.md)
- Listings must carry the off-road vs street-legal flag; see [[glossary]].
