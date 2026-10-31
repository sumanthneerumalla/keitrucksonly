# Kei truck dealers in the US and Canada: merged ranking

Date: 2026-10-31. This merges two files:
- `dealer-prospects.csv`: 54 dealers with current listing counts, website platform and how each could be ingested.
- `dealer-sales-evidence.md`: estimated sales volume, with sources.

**Caveats:**
- Most dealers are private, so most sales figures are estimates.
- Listing counts are snapshots and sometimes include sold units, parts or non-kei vehicles. The notes say when.
- Market context: about 7,500 kei imports a year into the US (2023). No dealer sells more than about 600 a year, so the market is very fragmented.

## ⚠️ Excluded: Kei Truck Direct (keitruckdirect.com)
It claims **949 vehicles "in stock"**, ten times any other dealer, which would make it #1 by listings. Do not list it or treat it as a real dealer until it has been verified. Red flags:
- **Domain registered 2026-07-13**, about 3.5 months ago, at Dynadot.
- Address is 185 Greenwich Ave, Goshen NY. That is next door to Kei Truck King (183 Greenwich Ave) and in the same town as HVNY Imports, a real dealer. But the phone number is **(385), a Utah area code**.
- **Bank wire only**, and the FAQ warns that "payment does not come back." Free insured door-to-door delivery anywhere in the lower 48. Prices start at $3,920.
- The site doesn't name an owner or legal entity.

This matches a common fake-dealer pattern: borrowing a real dealer's neighbourhood, offering huge inventory and taking non-refundable wires. It is **not proven fraud**, but it is exactly the kind of listing a vetting step has to catch. It also strengthens the case for the "trust" angle in the strategy.

## Tier 1: largest by estimated sales or inventory
| Dealer | Location | Est. trucks/yr | Listed now | Platform / ingest | Confidence |
|---|---|---|---|---|---|
| JDM Hawaii | Honolulu, HI | ~550–600 (includes vans and cars) | — | — (serves Hawaii) | Med |
| Boeki USA | Paterson NJ, plus NY and WA locations | ~300–420 | 71 at the NJ location | Custom PHP site, needs a scraper | Med (volume) |
| Skyline Kei Trucks | Houston, TX | "300+" (dealer's own claim) | 49 available of 157 | **Shopify products.json** (easy) | Low–Med |
| Lancaster Mini Truck | Lancaster, PA | ~180–240 ("15–20 a month") | — | No website found | Med |
| Mayberry Mini Trucks | Mount Airy, NC | ~150–400 (est.) | 62 | Site loads listings with JavaScript from its own API; needs a feed or permission | Low |
| Northwest Mini Trucks | Vancouver, WA | Unknown | **161–218**, the largest real single-dealer inventory found | Not yet profiled | Low |
| G&R Imports | Jackson, MO | Unknown; claims to be "largest dealer of mini trucks and parts" | 434 store products (trucks and parts mixed) | Wix store | Low |
| minitrucks.net | US and AU warehouses | Unknown | 124 vehicles (mostly new off-road-only units) | **Shopify products.json** (easy) | Low |
| JPM Mini Trucks | Miami, FL | "500+ sold" in total (dealer's claim) | 489 products (trucks and parts mixed) | **Public WooCommerce product API** (easy) | Low |

## Tier 2: established mid-size dealers
| Dealer | Location | Est./yr | Listed | Ingest |
|---|---|---|---|---|
| HVNY Imports | Goshen, NY | ~100–150 | — | Not profiled |
| Kuruma Imports | Miami, FL | — | 99 | Dealer-website vendor |
| Duncan Imports | Christiansburg, VA | — | 61 kei | Dealer.com; sitemap lists ~137 vehicle pages |
| Mini Truck Imports | LA | — | 84 (includes parts) | **Public WooCommerce product API** |
| Arizona Kei Trucks | Mesa, AZ | — | 56 | **Public WooCommerce product API** |
| Granite State Imports | Hopkinton, NH | ~50–100 | 15 | Wix store |
| Tiki Bunny Imports | Milwaukee, WI | ~60 | — | No website found |
| Mars Mini Trucks | Mars Hill, NC | ~60 | 6 | Squarespace |
| Krazy Kei Imports | Milwaukee, WI | ~40 | 6 | GoDaddy site builder |
| The Import Guys | Ferndale, WA | — | 31 | Wix |
| Weatherford Mini Trucks | Weatherford, TX | — | 23 | Base44 app; loads with JavaScript |
| Sunshine Imports | Austin, TX | — | 23 available | **Shopify products.json** |
| Tokyo Motors DC | Boyds, MD | — | 27 available | **Shopify products.json** |

## Canada
| Dealer | Location | Listed | Note |
|---|---|---|---|
| JDM Connection | AB | 268 (all JDM vehicles) | Public WooCommerce product API |
| Manga Auto Import | QC | ~113 (all types) | WordPress with vehicle sitemap |
| Japan Canada Motors | AB | ~97 | Elementor site |
| Keitruck.ca | QC | 79 | Wix store, French-language |
| SamuraiTrucks | AB | ~34 | Licensed in Alberta, in business since 2001 |
| Japanese Mini Trucks (SK), West Shore Auto (BC) | — | — | Both claim to be "Canada's largest", no numbers |

## Competing aggregators, not dealers
keitruckus.com (Oiwa: 18 dealers, 402 listings), jdmbuysell.com (~1,000 kei listings), Fourbie Exchange, JDM Supply, Mini Truck Depot.

## Takeaways for v0
1. **Seed set: 12 dealers with structured data that is easy to read.**
   - Shopify: Skyline, Sunshine, Tokyo Motors DC, Texas JDM, Kei Trucks America, minitrucks.net.
   - WooCommerce: JPM, Mini Truck Imports, Arizona Kei Trucks, JDM Connection.
   - Vehicle data embedded in their pages: Duncan, Kei Evolution.
   - That is roughly 300–500 live listings from three generic adapters and no custom scrapers.
2. **Large dealers that need a conversation, not a scraper:** Boeki USA, Mayberry, Northwest Mini Trucks, Lancaster, G&R. Ask them for a CSV or feed, or permission.
3. **Every new dealer needs a vetting checklist before going live:**
   - domain age
   - name and address match public business records
   - phone area code matches the location
   - payment methods (wire-only plus non-refundable is a red flag)
   - presence on Google Maps or the BBB
4. **Coverage gaps:** no dealers found in GA, TN, OH, ME or OR.
