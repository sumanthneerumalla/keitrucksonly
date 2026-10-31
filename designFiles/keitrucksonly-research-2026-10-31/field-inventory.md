# Kei truck listing field inventory (one unit per dealer)

> Raw-source copy (2026-10-31, agent:listing-sampler). Relative paths such as `raw/`, `work/`, `samples.jsonl` and `tools/` refer to the scratchpad capture dir `/private/tmp/claude-501/-Users-sumanth-Desktop-shuttlementorWorkspace/97f6b0eb-7d40-40c0-bc46-9a51ccf5690a/scratchpad/listings/` (not in the repo).

Captured 2026-10-31. **51 listings sampled** from 50 dealers in the canonical CSV, plus Northwest Mini Trucks as a bonus (not in the CSV). That is 50 of the 61 CSV rows; the other 11 could not be sampled (see the end of this file).

Inputs:
- One-line-per-dealer data: `samples.jsonl`
- Raw payloads: `raw/<slug>.json|.html`, plus the Browser Farm captures in `raw/<slug>/`
- Per-attribute evidence: `work/coverage.json` and `work/coverage_evidence.json`, produced by `tools/build_samples.py`

## How the counts were made (read first)

Every sample is classified for each attribute into one of four buckets:
- **machine:** a named field in an API or JSON-LD payload, such as Shopify or WooCommerce JSON, the dealer's own API, or schema.org.
- **page-spec:** a labelled value in the rendered page, such as a spec table, a "Label: value" line, a feature chip, or a Wix ribbon.
- **text:** found only in the title or description, by regex.
- **none:** not found anywhere.

Caveats:
- The **text** counts are regex estimates. For HTML-only dealers the scanned text includes template boilerplate on the listing page (financing and shipping disclaimers, for example), so warranty, shipping and financing are over-counted.
- Some machine fields are **present but wrong**. For example, the Mars JSON-LD describes a different vehicle, the Superior JSON-LD price is 0, and Rocky Mountain's "price" is a deposit. These are listed under messiness and were excluded or overridden where noted.
- The mix is kei-heavy: about 36 of 51 units are 25+ year imports (2001 or older). Four are 2002–2006 units at Canadian dealers (15-year rule). About 5 are new 2021–2026 off-road units, from Mini Monsters, Dakota, Mile High, Mini Trucks Ohio and US Mini Truck Sales.

## 1. Coverage matrix (N = 51 sampled listings)

| Canonical attribute | machine | page-spec | text only | none | Notes |
|---|---|---|---|---|---|
| make | 22 | 9 | 20 | 0 | Always recoverable. Usually in the title. Shopify `vendor` is the dealer name, not the make. |
| model | 13 | 13 | 24 | 1 | Many spellings. One source put features in the model field. |
| chassis code (DA63T, S210P…) | 2 | 5 | 20 | 24 | **Derivable from the frame number in 25 of 51.** Only 7 give it as its own field. |
| model year | 14 | 10 | 26 | 1 | Title-year is near universal. URL slug years sometimes disagree with the title. |
| build / first-registration month | 0 | 4 | 0 | 47 | Mars "First registered February 1998 (Heisei 10)", JPN "Manufactured March 1999", B-Pro "MODEL YEAR 2002-08", Dyna "H18 Month 1". |
| frame / chassis number ("VIN") | 9 | 17 | 2 | 23 | 26 dealers expose it, in 5 formats (see messiness). |
| price | 30 | 18 | 3 | 0 | 3 sources mean something else by "price": deposit, 0, or "Contact us". |
| currency | 29 | 0 | 2 | 20 | Must be inferred for Canadian dealers when not stated. Manga, Japan Canada and JDM Connection are CAD. |
| price type (asking / OBO / call / sale / deposit) | 0 | 0 | 9 | 42 | No dealer structures it. Seen: "+ Tax", "Cleared Customs Price", regular vs sale price (3), "*Fees Not Disclosed", "price without the pump – can be negotiated", "$500 refundable deposit". |
| status | 29 | 2 | 7 | 13 | Machine status is mostly schema `InStock`/`PreOrder` or Woo `is_in_stock`; it rarely reflects pending, arriving or sold. Real status lives in ribbons, title prefixes and categories. |
| mileage | 10 | 25 | 11 | 5 | |
| mileage unit | 7 | 0 | 26 | 18 | Units: km only 8, mi only 14, both 20, neither 9. |
| engine cc / engine code | 5 | 21 | 18 | 7 | Values like "660", "660cc", "0.65 L 3-cyl", "I3 0.6", "660L 3" (sic), "EF", "F6A", "3G83", "E07A", "EFNS". |
| transmission | 10 | 24 | 14 | 3 | Values: "5 Speed", "5-Sp Manual", "MT", "MANUAL", "4-Speed" (Acty Attack), "AT", "CVT". |
| drive (2WD/4WD) | 8 | 23 | 19 | 1 | Values: "4WD", "4X4", "AWD", "4x4, 4WD", "Selectable 4×4", "FULLTIME 4WD", "2 Wheel Drive". |
| hi/lo, extra-low, ultra-low | 2 | 2 | 15 | 32 | Structured only at Mayberry (`options` "Ex Low 1"), minitrucks.net (tag "Hi/Lo Gears"), Boeki (chip "LO/HI") and Kei Truck King ("High-Low Transfer Case"). |
| diff lock | 3 | 0 | 9 | 39 | Mayberry option, minitrucks.net tag, JPM tag. Otherwise prose or title ("Hijet,4x4,HI-LO. DIF-LOCK"). |
| body type (std / dump / scissor / van / jumbo / fire …) | 4 | 7 | 16 | 24 | Generic "Truck", "Pickup" or "Mini Truck" body fields are **not** counted. That field is useless for kei. |
| bed features (3-way gates, PTO, fold-down) | 0 | 5 | 9 | 37 | |
| A/C | 1 | 8 | 22 | 20 | |
| power steering | 0 | 2 | 14 | 35 | |
| colour | 9 | 24 | 4 | 14 | |
| condition / rust notes / grade | 1 | 13 | 15 | 22 | Auction grade only at Boeki ("4/B"), JPN ("3.5") and Dyna (full sheet). |
| new vs used | 10 | 7 | 11 | 23 | Schema `itemCondition` is unreliable: minitrucks.net marks a 1994 truck New, and Speedworks marks a 1990 truck New. |
| title status | 1 | 8 | 15 | 27 | Only Mayberry has a boolean (`titleInHand`). Others say "Title Status CLEAN", "TITLING Yes", "Title: Yes", or name a state title in prose. |
| legal class (street-legal 25yr vs off-road new) | 2 | 2 | 13 | 34 | Weatherford `inventory_lane` (`street_legal_25_plus` / `off_road_new`), minitrucks.net tags "Street Legal" and "Over 25 Years Old". |
| location (city / state) | 0 | 11 | 28 | 12 | Mostly the dealer's address. Unit-level location only for multi-lot dealers (Boeki "Franklin NJ", minitrucks "USA", JPM "Mini Trucks in USA/Japan"). |
| photos | 51 | – | – | – | Median about 13 per unit. Counts range from 1 (JPM) to 45 (Mayberry). HTML-derived counts are approximate. |
| video | 0 | 0 | 6 | 45 | Per-unit video is under-detected here. Estimate 8–10: minitrucks product video, JPN YouTube per unit, Kuruma "Play Video", Japstar/Street Legal walk-around, JMT YouTube. |
| dealer stock number | 16 | 14 | 1 | 20 | Often equals the frame-number tail (Japan Direct 2320, Kuruma 3537). |
| warranty | 0 | 2 | 17 | 32 | "Sold as-is" is the norm. Japan Canada Motors includes a 3-month powertrain warranty. Mile High: "WARRANTY: Yes". |
| shipping | 1 | 1 | 14 | 35 | Dyna JSON-LD `shippingDetails` (CAD 0–2,500). Mini Monsters ZIP × $/mile estimator. |
| financing | 0 | 0 | 14 | 37 | Common lenders: LightStream, J.J. Best, Woodside, Fairstone (Canada). Several note that a JDM frame number isn't a 17-digit VIN, which blocks bank auto loans. |
| date listed / arrived | 9 | 0 | 7 | 35 | Shopify `created_at` and `published_at`; Weatherford `arrival_date`; Mayberry `purchaseDate` (dealer acquisition). Ship name and ETA in Skyline's spec table. |

**Top 10 most reliably available** (machine + page-spec, out of 51):
1. Photos (51)
2. Price (48, with 3 traps)
3. Transmission (34)
4. Colour (33)
5. Drive (31)
6. Make (31; 51 counting text)
7. Status (31, but shallow)
8. Stock number (30)
9. Currency (29)
10. Mileage (35 counting free-form values; the unit is explicit in only 7)

Model and year are effectively 100% but need parsing from titles (26 or more are title-only).

## 2. Where each attribute hides, with real examples

**Title strings carry the most.**
- Tokyo Motors DC: "2000 SUZUKI CARRY - 4WD -FUEL INJECTED - 2 SPEED TRANSFER-CASE - A/C - ONLY 38k MILES — LOT#986"
- Northwest: "1996 Mitsubishi Minicab 4WD, 2Hi-4Hi-4Lo, PS, AC, 5MT"
- JDM RHD: "2001 Daihatsu Hijet,4x4,HI-LO. DIF-LOCK", where the title doubles as the model field
- Texas JDM: "1999 Honda Acty 4x4 "Rothmans" Stk#13867"
- Status prefixes: Sunshine "[JUST LANDED]"; Japan Direct "*PENDING*" and "*SOLD*"
- Mileage in the title: Granite "– 70K MILES"
- Restomod names: Kei Evolution "SDX 4×4 (Restored)"

**Description bodies.**
- Shopify `body_html` used as a spec table: Kei Trucks America "Manufacturer / Brand Hi Jet / Chassis No S210P-0044678 / Odometer (km) 10000 / WD 4WD / Turbo Charger No…"
- One-line pipe or slash spec: The Import Guys "EFNS / 4WD / Manual / 27,xxx miles"
- Dash bullets: Krazy Kei "-Selectable 4WD -Heat & A/C -60K Original Miles (97K KM)"
- Long SEO prose: JP Trade, Japan Direct, JDM Offroad

**Spec tables (rendered).**
- dealerwebsites.com template (Fun Karz, Northeast, Mud Hog, Kuruma): Stock NO, VIN, Body Style, Mileage, Engine, Transmission, Drive, Exterior/Interior Color, Title Status, Condition
- Carsforsale template (JDM Car & Moto, JDM RHD): Trim "4WD EXT", decoded factory specs
- WordPress Pods sites (Mile High, Mini Trucks Ohio, US Mini Truck): PRICE, MAKE, MODEL, MILEAGE, VIN, STOCK NO, WARRANTY, TITLING

**Tags, options, categories.**
- minitrucks.net tags: "4 Speed Manual, 4WD, Diff Lock, Dump Bed, Hi/Lo Gears, Over 25 Years Old, S83P, S83P-144494, Street Legal, USA"
- Mayberry `options[]`: 4WD, Diff Lock, Ex Low 1
- JPM tags: "4WD, attack, diff lock, efi"
- JPM categories double as location ("Mini Trucks in USA/Japan/Australia")
- Woo attributes (JP Trade): Body Type, Make, Model, Options, Status

**Feature checklists.**
- Boeki renders a fixed chip list where each chip is active or `class="inactive"`: 4WD, 2WD, 2x4, LO/HI, Axle Lock, Diff Lock, Hub Lock, EL, UL, UR, H Dump, L Dump, PTO, PS, PW, AW, SR, ABS, SRS, Lthr, Audio, TV, Navi. This is the best kei-specific schema on any dealer site.

**Wix ribbons and grid badges.**
- Granite "IN STOCK/AC", "INCOMING/LOWEST MILEAGE"
- The Import Guys "5,388 Miles! Difflock!"
- Motorcycle Warehouse uses the mileage as the ribbon

**Auction sheets.**
- Dyna Motor Imports publishes a translated auction sheet: overall grade 3.5, interior/exterior C/C, model code EBD-DA63T, Heisei date, shaken expiry, and inspector damage codes A1–A3, C1–C3, S1–S3, U.
- Boeki and JPN publish a grade only.

**URLs / slugs.**
- Rocky Mountain "1994-daihatsu-hijet-4wd-s83p-154521"; buykeitrucks "1999-suzuki-carry-db52t-104041" (year-make-model-chassis-serial)
- Mayberry keys the unit URL by chassis number (/inventory/KS4-322293)
- Boeki base64 IDs

## 3. Messiness catalogue (normalisation rules we'll need)

- **Make/model spellings:**
  - Hijet appears as "Hi Jet", "HiJet", "Hi-Jet", "HIJET", "Hije" (Weatherford record)
  - "MiniCab" vs "Minicab", "ACTY" vs "Acty"
  - "MINCAB" in a Fun Karz URL; "Daihastu" (Weatherford title)
  - Make "Daihatsu (Made by Toyota)" (US Mini Truck)
  - G&R JSON-LD brand "Daihatsu" on a Suzuki
  - Mars stale JSON-LD says Toyota Estima
  - "Nissan Clipper" listed under a minicab slug (Northwest: "2001-mitsubishi-minicab-hd-dump" titled "2001 Nissan Clipper HD Dump")
  - Trims: "Super Jumbo", "Climber", "Attack", "SDX", "KA", "KU", "Extra", "TC Limited", "Town", "Street"
- **Model field abuse:**
  - JDM RHD model "Hijet,4x4,HI-LO. DIF-LOCK"
  - Kei Evolution model "Acty SDX"
  - Mayberry `modelCode` = stock number
  - G&R "Model: DB51T" (chassis code in the model field)
  - Mini Trucks Ohio model "Hijet HD Dump Truck" on a Standard truck
- **Frame number formats** (one concept, 5+ formats):
  - With hyphen: S210P-0044678
  - Without hyphen: S210P0102320, DB52T145594
  - Zero-padded to 17 characters: "00000S210P0028506" (Duncan)
  - Masked: "S210P-0018044****"
  - Truncated to the code: "S510P", or chassis code only, "S210W" (Samurai)
  - Odd values: "HAY-2304376", and Speedworks "VIN" is actually the stock number "114932"
  - Normalise to `{chassis_code, serial}` with regex `^([A-Z]{1,3}\d{1,3}[A-Z]{0,2})-?0*(\d{5,7})$`. Never treat as a 17-digit VIN.
- **Mileage:**
  - No unit: "62,277", "9", "41,700"
  - Wrong unit: "35,111 KM (21,816 KM)"
  - Approximate or masked: "27,xxx miles"
  - Text-only: "NEW", "0 miles"
  - Units inside the value: "83 400 km" (French spacing), "20km", "15 KM", "24,194 Miles " (Weatherford free text)
  - Shopify `vendor` = "53,990 miles" (Texas JDM)
  - Both units with the conversion ("70,000KM / 43,500MI")
  - Store the original value, original unit, converted miles, and who converted (dealer or us).
- **Year:**
  - Slug year differs from page year (Mile High slug 2026 vs 2025; Mini Trucks Ohio slug 2021 page NEW; minitrucks handle 2001 title 2000)
  - Japanese era dates (Heisei 10, H18)
  - Year-month values ("2002-08")
  - Model range "1990-98" in a Motorcycle Warehouse product name
- **Price:**
  - Deposit shown as price (Rocky Mountain $500)
  - 0 in JSON-LD (Superior) and 0 for sold items (Japan Direct)
  - Woo Store API prices in minor units ("980000" = $9,800.00)
  - Regular vs sale/cash price (Keitruck.ca CA$10,640 / CA$9,250; Krazy $8,995 / $7,995; buykeitrucks $11,050 / $9,600)
  - "Ask"; "+ Tax"; "Cleared Customs Price" (CAD); "*Fees not disclosed"
  - "Contact us for pricing" next to a listed $7,950 (Motorcycle Warehouse)
  - Price only in prose ("Offered at $15,900")
- **Status:**
  - AZ product in categories Inventory + En-Route + Sold at once
  - Woo `is_in_stock` true while tagged "Sold Out" (Mini Truck Imports)
  - Schema `PreOrder` used for in-transit (Skyline)
  - Placeholder arrival dates (Weatherford 2027-01-01)
  - Status found only in description ("INCOMING NOVEMBER 2026", "EN PRÉPARATION À NOTRE ATELIER")
- **Contradictions in descriptions:**
  - AZ: "4WD … driving the rear wheels", and calls a 1999 4WD an HA6
  - Mini Truck Imports: short description says "Daihatsu Minitruck 2008" on a 1996 Acty, and "4 Wheel Drive (FWD)"
  - Dyna: serial DA65T vs auction sheet DA63T
  - JDM Offroad: SEO filler mixing K6A and F6A
- **"4x4 in title only":** about 19 sources put drive only in the title or text. Feature words are often packed into ALL-CAPS titles.
- **Body type:** generic platform fields say "Truck", "Pickup", "Mini Truck", "Truck/Pickup" or "Light Duty Truck". The kei body (dump, scissor, PTO dump, deck van, jumbo, fire unit, crane, flatbed with drop sides) lives in the title or features.

## 4. Kei-specific attributes that would make great search filters (evidence)

1. **Platform family / model with rebadges**
   - Seen: Clipper sold as a Minicab (Northwest), "Daihatsu (Made by Toyota)", and the Pixis/Sambar-on-Hijet era in new units
   - Search for Carry should include Scrum. Hijet should include Pixis and post-2012 Sambar (see terminology.md).
2. **Chassis code (generation)**
   - Derivable from the frame number in 25 of 51 listings, and present somewhere in 29
   - It encodes generation and 2WD/4WD. The second digit is 4WD: HA3/HA4, S200P/S210P, TT1/TT2, U41T/U42T.
   - Buyers buy parts by code; JMT and West Shore organise parts stores by code.
3. **Drive + low-range system**
   - 4WD appears in nearly all used samples
   - Low-range wording splits into hi/lo transfer case ("2H-4H-4L", "2 speed transfer-case") vs extra-low first gear ("Ex Low 1", "EL", "UL Ultra-Low first and UR Ultra-Low reverse")
   - Separate facets: `low_range: transfer_case | extra_low_gear | both | none`
4. **Diff lock:** present on about 12 samples, structured on 3. A high-value filter for farm and hunting buyers.
5. **Body / bed type:** standard flatbed with 3-way drop sides, dump (electric/hydraulic vs PTO), scissor dump, jumbo cab, deck van, panel van, fire truck, crane, refrigerated box. Dump units carry the clearest price premium (dump median $10.5k, per Muse).
6. **Legal class:** 25+ yr import (street-legal-eligible depending on state) vs new 2020s off-road-only (Weatherford lane; Mini Monsters "This vehicle is not street legal"; Dakota SD off-road vehicle title; Mile High CO OHV). The two have separate price markets ($7k–$16k vs $24k–$35k).
7. **Title status:** clean state title in hand (which state), export docs only, off-road title, pending. Highly asked by buyers; structured in only 9 of 51.
8. **Transmission:** 5MT / 4MT / 3AT / CVT. The AT and CVT minority is in demand.
9. **Odometer in km vs mi** (normalised). Also flag "true miles unknown".
10. **Auction grade / condition grade** (Boeki 4/B, JPN 3.5, Dyna 3.5 C/C). Only 3 dealers, but it is the only cross-dealer comparable condition signal.
11. **Supercharged/turbo, EFI vs carb, A/C, PS:** commonly in titles (Weatherford "Sambar Supercharger", Texas JDM "Carry Turbo", JP Trade "EFI").
12. **Upfits:** lift kit, ATV tires, snorkel, camo, bed liner, plow-ready. Common in US resale copy (Street Legal, JMT, Mud Hog, Mile High, Dakota).

## 5. Notable outliers

- **New off-road-only units:** Mini Monsters, Dakota, Mile High, Mini Trucks Ohio, US Mini Truck Sales, Weatherford's on-lot stock, most of minitrucks.net, and some Duncan. $24k–$35k, with pre-orders, CVT and "Made by Toyota". Weatherford's 25+ yr units are all "arriving".
- **Mixed parts stores:** G&R (434 products, mostly parts), JPM (489 products), minitrucks.net, Rocky Mountain, JMT (vehicles only on pages), Keitruck.ca (tyres and wheels), Mini Truck Imports (accessories).
- **Mixed JDM stock:** Japan Direct (Mail-Route RHD SUVs), Duncan, Texas JDM (postal Jeeps), The Import Guys, Speedworks, JDM Offroad (Land Cruisers), Manga, Motorcycle Warehouse (excavators and trailers).
- **Multi-location:** Boeki (NJ/NY/WA URL scheme, units at "Franklin NJ"), JDM Car & Motorcycle (Shoreline + Sequim WA, plus the Crossville TN sister site, with the lot coded in the stock number), minitrucks.net (JP/US/AU stock), JPM (USA/Japan/Australia categories), Skyline (Houston lot + arriving ships).
- **Import-to-order / Japan stock:** B-Pro (exporter feed IDs, katakana leakage), JPM import-to-order vans, Street Legal "Japan Stock", The Import Guys "Japanese Auctions".
- **Restomod premium:** Kei Evolution $50,000 Acty, Texas JDM "Rothmans" livery, Japstar aftermarket list.
- **No per-unit URL:** JMT (paragraphs on a page) and Weatherford (cards linking to the contact form) need synthetic IDs.
- **Duplicate operator:** Street Legal Mini Trucks = Japstar Imports (same CMS and copy). Boeki WA shares a phone number with Northwest Mini Trucks.

## 6. Ingest-method summary (for the model, not the scraper)

| Method | Dealers sampled | Needs JS |
|---|---|---|
| Shopify products.json | 6 | no |
| WooCommerce Store API | 5 | no (Dakota is 401) |
| Dealer JSON API (Mayberry, Weatherford Base44) | 2 | no for the API (the sites are SPAs) |
| Squarespace ?format=json | 1 | no |
| JSON-LD on detail page (Wix, Carsforsale, Dealer.com, Next.js, Rails, WP vehicle) | ~16 | no, except Duncan (curl 403) |
| HTML spec scrape only | ~21 | no, except buykeitrucks.ca (client-rendered) and JDM Offroad (curl 403) |

Only 3 of 51 strictly needed a real browser: Duncan and JDM Offroad (bot walls) and buykeitrucks.ca (client-rendered). Mayberry and Weatherford would need one too without their APIs.

## 7. Dealers not sampled (11 of 61 CSV rows)

| Dealer | Why |
|---|---|
| Kei Truck Direct | Skipped by instruction (suspected fake) |
| Mini Truck Depot | Aggregator / dealer network |
| Tiki Bunny | No website found |
| Lancaster Mini Truck | No website found |
| JDM Drive Inc | jdmdrive.com TLS certificate invalid (`ERR_CERT_COMMON_NAME_INVALID`) |
| Mini Trucks South LLC | WordPress critical error, HTTP 500 (still down 2026-10-31) |
| KEI Import Parts | Parts only |
| West Shore Auto (minitruck.ca) | Parts only now |
| Star Truck Enterprises | Inactive blog (last post 2015) |
| KeiCraze Customs | No per-vehicle listings |
| SODO Moto | No kei truck in stock (33 in-stock vehicles, none kei) |

Sampled with caveats:
- **Arizona Kei Trucks:** no available kei truck, so an en-route unit was sampled.
- **Weatherford:** 25yr units are all arriving_soon.
- **Dakota:** the first pick was SOLD, so it was re-sampled.
- **US Mini Truck Sales / Mini Trucks Ohio:** slug-reused pages.
