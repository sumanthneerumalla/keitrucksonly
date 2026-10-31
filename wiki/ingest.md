---
title: Inventory ingest
type: topic
tags: [ingest]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-handoff.md, designFiles/dealer-ranking.md, designFiles/keitrucksonly-research-2026-10-31/dealers.md]
---
**Summary:** Generic adapters, not per-site scrapers. Nothing built yet (D-005). Per-dealer method is in `designFiles/dealer-prospects.csv` and on [[dealers]] pages.

## Adapters (planned, D-006)
- ingest/shopify: `GET /products.json`, filter on `variants.available`. Seeds: Skyline, Sunshine Imports, Tokyo Motors DC, Texas JDM, Kei Trucks America, minitrucks.net.
- ingest/woocommerce: public Store API `/wp-json/wc/store/products`. Seeds: JPM, Mini Truck Imports, Arizona Kei Trucks, JDM Connection.
- ingest/sitemap + JSON-LD: Duncan Imports, Kei Evolution, [[northwest-mini-trucks]].
- ingest/json-api (dealer's own public endpoint): [[mayberry-mini-trucks]], [[weatherford-mini-trucks]].
- The 12 seed dealers ≈ 300–500 listings. (2026-10-31, handoff)

## Rules
- Hide listings not seen for 72 h (D-003).
- Parts and non-kei vehicles appear in many feeds; filter by title/category.
- Large dealers without feeds (Boeki, Mayberry, Northwest, Lancaster, G&R) need a conversation: CSV, feed or permission. (2026-10-31, dealer-ranking.md)
