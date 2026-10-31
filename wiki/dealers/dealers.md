---
title: Dealers overview
type: topic
tags: [dealer, research]
updated: 2026-10-31
sources: [designFiles/dealer-ranking.md, designFiles/dealer-prospects.csv, designFiles/dealer-sales-evidence.md, designFiles/keitrucksonly-research-2026-10-31/gap-states.md]
---
**Summary:** Tiered view of US/Canada kei dealers. Full list (54 rows, listing counts, platform, ingest method, contacts): `designFiles/dealer-prospects.csv`. Market: ~7,500 kei imports/yr (2023), no dealer above ~600/yr. (2026-10-31)

## Tier 1 (largest by est. sales or inventory)
| Dealer | Location | Est. trucks/yr | Listed | Ingest |
|---|---|---|---|---|
| JDM Hawaii | Honolulu HI | ~550-600 (all kei) | n/a | serves Hawaii only |
| [[boeki-usa]] | Paterson NJ (+NY, WA) | ~300-420 | 71 NJ | custom PHP |
| [[skyline-kei-trucks]] | Houston TX | "300+" claim | 49 of 157 | Shopify |
| [[lancaster-mini-truck]] | Lancaster PA | ~180-240 | n/a | no website |
| [[mayberry-mini-trucks]] | Mount Airy NC | ~150-400 (low conf.) | 65 | JSON API |
| [[northwest-mini-trucks]] | Vancouver WA | unknown | ~147 trucks (210 units) | HTML + JSON-LD |
| [[g-and-r-imports]] | Jackson MO | unknown | 434 products | Wix |
| minitrucks.net | US/AU warehouses | unknown | 124 | Shopify |
| [[jpm-mini-trucks]] | Miami FL | "500+ sold" claim | 489 products | WooCommerce |

## Tier 2
- [[hvny-imports]] (Goshen NY, ~100-150/yr), Kuruma Imports (Miami, 99), Duncan Imports (VA, 61 kei), Mini Truck Imports (LA, 84), Arizona Kei Trucks (Mesa, 56), Granite State Imports (NH, ~50-100/yr), Tiki Bunny (Milwaukee, ~60/yr), Mars Mini Trucks (NC, ~60/yr), Krazy Kei (Milwaukee, ~40/yr), The Import Guys (Ferndale WA, 31), [[weatherford-mini-trucks]] (TX, 31 live), Sunshine Imports (Austin, 23), Tokyo Motors DC (MD, 27). (2026-10-31, dealer-ranking.md)
- Canada: JDM Connection AB (268), Manga Auto Import QC, Japan Canada Motors AB, Keitruck.ca QC, SamuraiTrucks AB. (2026-10-31, dealer-ranking.md)
- Aggregators, not dealers: keitruckus.com (Oiwa), jdmbuysell.com, Fourbie Exchange, JDM Supply, Mini Truck Depot. See [[competitors]].
- Excluded: [[keitruckdirect]].

## Gap-state dealers (GA, TN, OH, ME, OR, CO; 2026-10-31, gap-states.md)
| Dealer | Place | Notes |
|---|---|---|
| Mini Trucks South | Covington GA | ~3 units; site HTTP 500 when checked |
| [[jdm-car-and-motorcycle]] (Crossville branch) | TN | ~45 kei of 53 |
| Mini Trucks Ohio | Van Wert OH | new Hijets, off-road only |
| JMT Ohio Sales | Chillicothe OH | 3 listed, used trucks, titled |
| Motorcycle Warehouse | Eagle Creek OR | ~6 kei; off-road/farm use only |
| Mile High Mini Trucks | Commerce City CO | new Hijets, OHV registration |
| KeiCraze Customs | Windsor CO | Acty builds; no inventory pages |
- Maine: no dealer found. Mini Trucks Ohio and Mile High share a WordPress stack, likely one operator or vendor.

## Vetting checklist (D-008, see [[decisions]])
- Domain age; name and address match public records; phone area code matches location.
- Payment methods: wire-only plus non-refundable is a red flag.
- Presence on Google Maps or BBB. (2026-10-31, dealer-ranking.md)

## Coverage notes
- Seed set for v0: 12 dealers with structured data; see [[ingest]]. Dealers needing a conversation: Boeki, Mayberry, Northwest, Lancaster, G&R.
- Estimates are mostly dealer claims or press quotes; confidence is low for many. (2026-10-31, dealer-sales-evidence.md)
