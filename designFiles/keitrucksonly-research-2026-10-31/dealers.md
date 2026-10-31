# Dealer inventory profiles: NW Mini Trucks, Mayberry, Weatherford

Data captured 2026-10-31 (live). Raw captures are in `../raw/` (nw_*.html, nw_parsed.json, may_inv.json, wf_pub.json, wf_trucks_*.json).
keitruckdirect.com was excluded, as instructed.

## Summary

| Dealer | Live kei trucks | Ingest path | Auth | Difficulty |
|---|---|---|---|---|
| Northwest Mini Trucks (WA) | **~147 trucks** (150 under the "Truck/Pickup" filter, minus 3 that aren't kei) + about 17 kei vans; 210 active units in all | Server-rendered HTML. One page holds all 210 cards, with no pagination. Each detail page has schema.org `Car` JSON-LD | none | Easy (HTML list + JSON-LD) |
| Mayberry Mini Trucks (NC) | **65** (63 In Stock, 2 Pending Sale), about 59 trucks + 6 vans | `GET https://api.mayberryminitrucks.com/inventory/getInventoryMetaData` returns the whole inventory as one JSON array | none | Trivial |
| Weatherford Mini Trucks (TX) | **31 live** (8 available, 5 reserved, 18 arriving_soon) out of 83 records (52 sold) | `POST https://weatherfordminitrucks.com/api/apps/698be11b118f14d14ebf9641/functions/getPublicTrucks` with body `{}` returns `{trucks:[...]}` | none | Trivial |

---

## 1. Northwest Mini Trucks, Vancouver WA

- **Site:** https://www.nwminitrucks.com (northwestminitrucks.com redirects here)
- **Contact:** phone 360-990-7770, email nwminitrucks@gmail.com (both from the site's JSON-LD `AutoDealer`). Address: 10611 NE Highway 99, Vancouver, WA 98686.
- **Platform:** Ruby/Rails app (`server: nginx + Phusion Passenger 6.0.22`) on a multi-tenant dealer-site product. Assets sit at `/assets/hosted/account_4035/...` and images on CloudFront `d3vd6h5tjc937b.cloudfront.net`. I couldn't identify the vendor. It is **not** Shopify or WooCommerce: `/products.json` and `/wp-json/wc/store/products` both return 404. No JSON API was found.
- **Inventory URLs:**
  - `/inventory/active` (also `/pages/inventory`): **210 cards on one page**, no pagination. GET filters: `make`, `year` (meaning that year and newer), `body_type` (Conversion/Coupe/Hatchback/SUV/Sedan/Truck/Pickup/Van/Wagon), `transmission`, `sort` (created_at|price|year|mileage), `d` (ASC/DESC).
  - `/inventory/active?body_type=Truck%2FPickup`: **150 cards**
  - `/inventory/incoming`: 22 cards. `/inventory/sold`: 259 cards. Both are useful for sold-price comps.
  - `/sitemap.xml`: 210 `/inventory/<slug>` URLs, matching the active list.
- **Card fields (list page):** URL slug, price (or "Reserved"), stock number, a long title (year, make, model and features), photo, exterior colour.
- **Detail page JSON-LD `@type: Car`:** name, url, image, `vehicleIdentificationNumber` (a JDM chassis number such as `U42T-0425553`), `sku` (stock number), brand, model, `vehicleModelDate` (year), `mileageFromOdometer` (in miles), color, interior color, `bodyType`, transmission, fuel, doors, engine, and `offers.price` / `availability`. 4WD isn't a structured field; it can be parsed reliably from the title, e.g. "4WD, 2Hi-4Hi-4Lo".
- **Mix (active 210):** Honda 47, Daihatsu 42, Subaru 35, Suzuki 32, Mitsubishi 30, Toyota 16, Nissan 5, Mazda 2, VW 1. The 60 non-truck units include JDM cars (Accord, Odyssey, Pajero, Torneo, Step Wgn and others) that a kei-only site must exclude. About 17 are kei vans (Vamos, Atrai, Sambar Dias/Van, Town Box, Street).
- **Trucks (150 under the filter):** Hi-Jet 35, Acty 29, Sambar 28, Carry 28, Minicab 24, plus one each of Clipper, Midget, Scrum, and three that aren't kei: Toyota LiteAce, Mitsubishi Canter, Mazda Bongo. That leaves about 147 kei trucks.
- **Price (trucks):** $6,995 to $24,995, median $13,995. One is listed as "Reserved". Model years run 1990 to 2001, so all are 25+ years old.
- **Samples:** 1996 Mitsubishi Minicab 4WD 5MT, 43,283 mi, $7,995 · 2001 Subaru Sambar HD Dump 4WD, $19,995 · 1999 Daihatsu Hi-Jet Climber Dump 4WD, $24,995 · 1997 Suzuki Carry 4WD, $9,995 · 1998 Honda Acty Town 4WD, $13,995.
- **Payment and terms:** a "Financing" nav link goes to a J.J. Best Banc loan application (classic and collector car lender). No wire, deposit or other payment terms are stated on the pages I checked.
- **Vetting:** domain registered 2018-05-06 (GoDaddy). The 360 area code covers SW Washington, which matches Vancouver WA. The address is a real highway frontage with matching geo coordinates. It uses a Gmail address, which is common for small dealers. **No red flags.** The prior estimate of 161–218 listings is consistent: 210 active, of which about 164 are kei trucks plus vans.
- **Ingest plan (later):** fetch `/inventory/active?body_type=Truck%2FPickup` (one request), then fetch each new or changed slug's detail page for the JSON-LD. Alternatively, diff `sitemap.xml` and fetch only the details. Drop entries whose model is Canter, Bongo or LiteAce. Optionally run `body_type=Van` and keep only kei vans.

## 2. Mayberry Mini Trucks, Mount Airy NC

- **Site:** https://mayberryminitrucks.com, a React/Vite SPA. The HTML is an empty `#root` shell.
- **Contact:** phone (336) 970-3885, email sales@mayberryminitrucks.com. Address: 407 Snow Lane, Mt Airy, NC 27030. All three come from the JS bundle footer.
- **API** (axios `baseURL: https://api.mayberryminitrucks.com`, Play Framework behind Cloudflare and Google Cloud):
  - `GET /inventory/getInventoryMetaData`: **the full public inventory, 65 items, about 105 KB**. No auth and no Origin header needed; a plain curl returns 200. The response is sent as `content-type: text/plain` but the body is JSON. CORS only allows the site's own origin, which doesn't matter for server-side fetches.
  - `GET /inventory/getInventoryItem?vin=<vin>`: a single item. It adds `id`, `purchaseDate` and a full `imageLinks[]` array (the list endpoint returns a single image URL string).
  - `GET /inventory/getTopTenInventoryMetaData`: home page carousel.
  - `GET /review/getBusinessDetails`: Google reviews, 5.0 rating from 299 reviews.
  - `POST /inventory/contactus`: lead form. It needs a CSRF token, and we should not touch it.
  - `/management/*`: admin endpoints with a Bearer token. Out of scope.
  - Images: `storage.googleapis.com/mayberry-mini-trucks-inventory-images/<VIN>/image-N`. The front end rewrites these to `cdn.mayberryminitrucks.com`.
- **Fields:** `vin` (chassis number), `modelCode`, `stockNumber`, `make`, `model`, `year` (string), `exteriorColor`, `interiorColor`, `mileage` (integer, miles), `transmission`, `engine`, `description`, `price` (integer USD), `titleInHand` (bool; false on all 65), `status` ("In Stock" / "Pending Sale"), `options[]` (4WD, 2WD, A/C, Power Steering, Hi/Low, Diff Lock, Ex Low, Dump, Van, Automatic...), `imageLinks`.
  - 4WD: 55 of 65 carry the `4WD` option tag.
- **Mix:** Carry 18, Hijet 15, Acty 13 (+1 Attack), Sambar 6, Minicab 1, Midget 1. Vans: Dias 2, Atrai 2, Sambar Van, Hijet Van, Every, Mitsubishi "Van". One Toyota Lite Ace and one Mazda Bongo, which aren't kei.
- **Price:** $7,200 to $16,400, median $8,800. Years 1990 to 2001. Transmission: 51 five-speed manual, 12 automatic.
- **Payment and terms:** nothing structured on the site. A review mentions a "refundable deposit". Descriptions say the trucks are NC street legal (Mayberry says it lobbied for the NC law) and that they make no claims about other states. A banner reads "CLOSING AT 3PM SATURDAY 10/31".
- **Vetting:** domain registered 2014-04-04. The 336 area code is the Piedmont Triad region, which includes Mount Airy. 299 Google reviews at 5.0. **No red flags.**
- **Ingest plan:** a single GET of `getInventoryMetaData`, keyed on `vin`. This is the cleanest source of the three.

## 3. Weatherford Mini Trucks, Weatherford TX

- **Site:** https://weatherfordminitrucks.com, a Base44 (no-code AI app builder) SPA. App id `698be11b118f14d14ebf9641`; that ObjectId's timestamp is 2026-02-11, so the current site is about 8 months old.
- **Contact:** phone (682) 332-6992 (call or text), email weatherfordminitrucks@gmail.com. Address: 1015 Fort Worth Highway, Weatherford, TX 76086. Hours Mon–Fri 9–5, Sat by appointment.
- **Endpoints** (seen in Browser Farm network capture on /inventory and /contact):
  - `POST /api/apps/698be11b118f14d14ebf9641/functions/getPublicTrucks` with body `{}` (the site sometimes sends `{lane}`) returns `{"trucks":[...]}`, **83 records, about 610 KB**. No auth. This is the site's intended public path.
  - The raw entity endpoint `GET /api/apps/<id>/entities/Truck` (also on `base44.app`) returns the same 83 records anonymously. The entity seems to be publicly readable at the platform level. **Use the function, not the entity endpoint.** Write endpoints were not tested and should not be.
  - Also seen: `functions/getPublicBlogPosts`, and `entities/User/me` (returns 401).
- **Fields:** `id`, `slug`, `title`, `year` (float), `make` (often has trailing spaces), `model` (messy: "Hije", "HIjet ", "Suzuki" used as a model), `price` (float), `original_price`, `status` (available/reserved/arriving_soon/sold), `condition` (new/pre-owned), `inventory_lane` (`off_road_new` = 74, `street_legal_25_plus` = 9), `category` (jumbo_cab/dump_truck/standard/deck_van), `drive` (4WD/4x4), `transmission`, `mileage` (free-text string such as "15 KM" or "24,194 Miles "), `chassis_number`, `stock_number`, `features[]`, `images[]` (url, alt, description), `arrival_date`, `is_featured`, `is_sample`, plus created and updated dates.
- **Live 31:** mostly **new 2025/2026 Daihatsu Hijets** (standard, Jumbo Cab, Deck Van, HD Dump), plus 2025 Suzuki Carry at $24,500–$30,995. These are sold for **off-road use only**; the FAQ says only 25+-year trucks can be street legal. The 8 arriving_soon units in the street_legal_25_plus lane are 1996–2001 trucks (Hijet Low Dump, Sambar Supercharger, Acty Attack, Carry ×4) at $8,500–$14,995. Only 8 units are "available" right now, all but one of them new.
- **Payment and terms:** financing through LightStream (Truist), with "rates as low as 6.49% APR" (from the FAQ). Ships anywhere in the continental US, quoted per trip. No manufacturer warranty, but an optional paid service contract. In-person or FaceTime viewing. No wire-only language.
- **Vetting:** domain registered 2012-10-15 (GoDaddy), while the site itself was rebuilt in 2026. The 682 area code is Fort Worth metro, which matches Weatherford. Gmail address. **No hard red flags.** Two soft ones:
  1. New off-road-only kei trucks are a different product from 25-year imports. Listings must carry the lane or legality flag.
  2. Data quality is weak: some arrival dates are 2027-01-01 placeholders, and mileage is free text.
- **Ingest plan:** one POST to `getPublicTrucks`. Filter `status != sold`. Map `inventory_lane` to a street-legal or off-road flag. Normalise make, model and mileage.

---

## Browser Farm notes (dogfooding)

- Runs worked: WF /inventory, /contact, /faq and Mayberry /inventory each took one session, at about 15–25 s per run. Sessions were released by the helper.
- **Quirk 1, filter misses an API:** `bf.mjs` only records responses whose content-type contains `json`. Mayberry's API returns JSON as `text/plain`, so `may_inv.net.json` captured **none** of the inventory calls. I found the endpoint by grepping the JS bundle. Suggest also capturing `xhr`/`fetch` resource types whatever the content-type.
- **Quirk 2, truncated bodies:** bodies are cut at 200,000 chars. Weatherford's `getPublicTrucks` (610 KB) was truncated in `.net.json`, so it needed a direct curl.
- **Quirk 3, mime error on empty prefix:** `Error: path: unsupported mime type "null"`. This was my mistake: zsh doesn't word-split `$p` in a loop, so the out prefix was empty and the screenshot path became `.png`, and an orphan `out/.txt/.html/.png` was left behind. The real lesson is that the helper should validate its arguments. Other agents also write to the shared `out/` directory at the same time, so unique prefixes matter.
- WF FAQ answers sit in collapsed accordions, so the rendered innerText only showed questions. I got the answers from the bundle instead. A click-through script would be needed to get them from the render.
- No blocks, CAPTCHAs or bot walls on any of the three sites. Plain curl worked for everything except finding endpoints on the JS-rendered sites.
