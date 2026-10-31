---
date: 2026-10-31
source: Claude in Chrome on owner's browser, relayed by owner; raw in designFiles/keitrucksonly-research-2026-10-31/samuraitrucks-chrome-capture.md
---
## SamuraiTrucks (→ [[dealers]], new dealer page if 3+ facts)
- Vehicle inventory is `/vehicles`; `/kei-trucks/` and `/kei-vans/` are parts catalogues. Ingest must target `/vehicles`.
- 17 in stock (badge AVAILABLE), 6 Coming Soon (section heading, no badge), 11 Recently Sold (badge SOLD, public archive). Inventory mixes kei with Townace, Atlas, Vanette, Bongo, Jimny.
- Custom static site behind Cloudflare (images under /Images/Vehicles/ + r2.dev, forms via Web3Forms). No JSON-LD noted. Browser Farm got a 403; the owner's own Chrome passed. ([[browserfarm]], [[ingest]])
- Prices CAD, often "Contact for Price"; km only, label "Mileage / Hours"; "Reserve Now" in titles/slugs with no deposit flow. Licensed with AMVIC (Alberta).
- Spec table is only 9 fields (Make, Model, Year, Chassis, Mileage / Hours, Drive, Transmission, Engine, Colour); chassis code is a structured field.

## Data model (→ [[data-model]])
- Price must allow price-on-request with no number; currency is required (CAD dealers exist).
- Status enum needs "coming soon" as its own value (matches Lancaster "Coming Soon").
- Legal class is jurisdiction-relative: Canada uses a 15-year import rule, US 25 years. Don't hard-code "25yr import".
- Dealer inventories include non-kei vehicles; every listing needs a kei/not-kei classification.

## Open question (→ [[open-questions]])
- Do we list Canadian dealers (CAD prices, 15-year rule, cross-border shipping) on a US-positioned site? SamuraiTrucks's US shipping is unconfirmed.
