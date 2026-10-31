---
title: Mayberry Mini Trucks
type: dealer
tags: [dealer, state/NC, ingest/json-api]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-research-2026-10-31/dealers.md, designFiles/dealer-sales-evidence.md, designFiles/keitrucksonly-research-2026-10-31/facebook.md]
---
**Summary:** Mount Airy NC dealer; cleanest ingest source: one public JSON endpoint. Part of [[dealers]].

- Location: 407 Snow Lane, Mt Airy NC 27030; phone (336) 970-3885; sales@mayberryminitrucks.com. (2026-10-31, dealers.md)
- Inventory: 65 live (63 In Stock, 2 Pending Sale), ~59 trucks + 6 vans; $7,200-$16,400, median $8,800; years 1990-2001. (2026-10-31, dealers.md)
- Ingest: `GET https://api.mayberryminitrucks.com/inventory/getInventoryMetaData` returns the whole inventory as JSON (sent as `text/plain`), no auth; key on `vin`. Site is a React SPA. Do not touch `POST /inventory/contactus` or `/management/*`. (2026-10-31, dealers.md)
- Fields include `titleInHand` (false on all 65). 4WD tagged on 55 of 65. (2026-10-31, dealers.md)
- Payment: nothing structured; a review mentions a "refundable deposit". Says trucks are NC street legal and makes no claims for other states. (2026-10-31, dealers.md)
- Vetting: domain registered 2014-04-04; 336 area code matches; 299 Google reviews at 5.0. No red flags. (2026-10-31, dealers.md)
- Volume: unknown, speculative ~150-400/yr; imports via Autocom Japan RORO to Jacksonville; in business since 2010. (2026-10-31, dealer-sales-evidence.md)
- Facebook: no page found; praised organically in Kei Truck Owners. (2026-10-31, facebook.md)
- Needs a permission conversation per [[ingest]].
