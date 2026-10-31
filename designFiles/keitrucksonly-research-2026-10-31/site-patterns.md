# Dealer site patterns (how kei dealers present inventory)

> Raw-source copy (2026-10-31, agent:listing-sampler). Relative paths such as `raw/`, `work/`, `samples.jsonl` and `tools/` refer to the scratchpad capture dir `/private/tmp/claude-501/-Users-sumanth-Desktop-shuttlementorWorkspace/97f6b0eb-7d40-40c0-bc46-9a51ccf5690a/scratchpad/listings/` (not in the repo).

Captured 2026-10-31 through The Browser Farm. For each dealer, one real session walked the site like a buyer: home → inventory index → one listing.
- 130 sessions in all, every one released (HTTP 200 on REQUEST_RELEASE).
- Screenshots are in `raw/<slug>/`: `home.jpg`, `inventory.jpg` (or `p2a/*.jpg`) and `p2/listing.jpg`, each with a `.full.jpg` full-page version.
- Text, HTML and link captures are saved alongside each screenshot.
- The field-level analysis is in `field-inventory.md`.

## Cross-dealer learnings

### Common patterns
1. **The listing title is the spec sheet.** Almost every dealer puts year, make, model and 2–6 feature tokens in the title, e.g. "4WD, 2Hi-4Hi-4Lo, PS, AC, 5MT" or "4WD - FUEL INJECTED - 2 SPEED TRANSFER-CASE - A/C". Structured fields, where they exist, are a subset of what the title says.
2. **Platform drives schema, not kei knowledge.**
   - Platforms seen: Shopify (7), WooCommerce (6), Wix (6), dealerwebsites.com template (4), WordPress-Pods "minitruck" plugin (3, all one vendor), Carsforsale (2), Squarespace (2), and one each of Dealer.com, Duda, GoDaddy, Base44, React SPA, Next.js, Rails, DealerCenter-style ASP and custom PHP.
   - Generic car templates force kei data into fields like "Body Style: Pickup" and "Trim: 4WD EXT", or a model of "Hijet,4x4,HI-LO. DIF-LOCK". Only Boeki (feature chips), Weatherford (lane/category) and minitrucks.net (tags) have kei-aware schemas.
3. **Status is a two-or-three-bucket lifecycle and almost never structured.**
   - The buckets are Available/In stock, Arriving/En route/Incoming/In transit/Coming soon, and Sold, with Pending/Reserved on some sites.
   - Dealers express it as separate pages (Northwest, AZ, JMT, JPN, Tokyo Motors, Kei Evolution, Mini Monsters, Skyline, Japan Canada "JDM Sold"), ribbons (Wix), title prefixes (Japan Direct *PENDING*, Sunshine [JUST LANDED]), or categories (Woo).
   - Sold archives are common: about 14 sites keep a public sold list, which is useful for price comps.
4. **"Arriving" inventory is a first-class product.** Dealers pre-sell units on the water:
   - Skyline names the ship and ETA.
   - Weatherford gives "Expected: Nov 30, 2026".
   - Rocky Mountain takes a "$500 refundable deposit".
   - Granite says "INCOMING NOVEMBER 2026".
   - AZ, Weatherford (25yr) and Skyline have more arriving stock than lot stock.
5. **Two separate markets on the same sites.**
   - 25+ year imports ($6k–$16k), labelled "25+ Year Trucks", "Over 25 Years Old", "25-year import rule: Eligible" or "Street Legal".
   - New 2020s units ($24k–$35k), labelled "Off-Road Use Only", "This vehicle is not street legal", "EPA certified", or titled with an "SD Offroad Vehicle Title" or "CO OHV registration".
   - Weatherford splits them into two nav items ("Off Road Mini Trucks" vs "25+ Year Trucks"), which is the clearest UX seen.
6. **Contact flow, not checkout.**
   - About 85% use an inquiry form plus phone/text. Typical labels: "Inquire", "Call Now", "Text to book a test drive", "Confirm availability", "Get a quote".
   - Deposit or reserve flows: Rocky Mountain ($500 Wix product), Dyna ("RESERVE — $1,000 DEPOSIT"), B-Pro ("PLACE DEPOSIT"), Skyline ("Arriving Soon RESERVE"), Mile High (reserve form), Dakota (deposit by phone).
   - True cart checkout on a vehicle: Krazy Kei ("BUY NOW / ADD TO CART"), JPM ("Reserve This Truck" checkout), G&R and minitrucks.net (cart).
   - Weatherford's form asks the intended use (farm, hunting, private property, public roads), which doubles as a legality screen.
7. **Photos are galleries of about 5–30 images.** Vendor templates print the count ("Photo Viewer 28 Images"). Video is rare but growing: JPN embeds a YouTube walk-around per unit, Japstar and Street Legal link "WALK AROUND VIDEO", Kuruma has "Play Video", and JMT posts YouTube.
8. **Filtering is weak or absent on kei-only sites.**
   - Real filters exist only on generic dealer platforms (make/model/year/price selects on dealerwebsites, Carsforsale, DealerCenter, Vehica), and on Weatherford (Category, Status, Transmission), Dyna (make, body type) and Skyline (Shopify collections by make and body).
   - Small kei sites (Mars, KTK, Granite, JMT, Kei Evolution, AZ) are a flat grid or one page.
   - Pagination: one long page (Northwest 210 cards, Mayberry), "Show more" (minitrucks), or numbered pages (Boeki, KTK, dealerwebsites, Carsforsale 24 per page).
9. **Trust content is everywhere.** Legality pages ("Arizona Kei Truck Laws 2025", "State Restrictions for Kei Trucks", Utah title blog), "How it works / Import process", sold archives, reviews, and financing-lender lists (LightStream, J.J. Best, Woodside, Fairstone). Payment methods are rarely stated; Street Legal and Japstar list "Cash, Zelle, Venmo, Bank Checks".

### Categories dealers already use (candidate facets)
- **By body:**
  - Standard / Regular Cab / Straight Truck
  - Jumbo Cab
  - Dump (HD Dump, Low Dump, PTO Dump, Scissor Dump/Lift)
  - Deck Van, Cargo Van, Kei Vans
  - Fire Trucks
  - Box trucks
  - Crew Cab
  - Extreme (Mini Monsters)
  - Custom Builds
- **By status:** Available, In Stock, On the Lot, Arriving Soon, En Route, Incoming, In Transit, Coming Soon, Reserved, Pending, Sold, Clearance.
- **By origin/legal lane:** 25+ Year Trucks vs Off-Road; USA Inventory vs Japan Stock; Mini Trucks in USA / Japan / Australia.
- **By make or model collection:** Daihatsu Hijet, Suzuki Carry, Honda Acty, Subaru Sambar, Daihatsu Midget II, Mitsubishi Minicab (Skyline, Texas JDM, Japan Car FL filters).
- **By drivetrain:** 4WD Mini Trucks, 2WD Mini Trucks, Automatic Mini Trucks (JPM).
- **Parts stores by chassis code:** JMT "Hijet S83P / Acty HA4 / HA7 / HA9 / Minicab U42T / U62T / U62V / Clipper U71/U72 / Sambar KS4/TT2"; West Shore "Hijet S80P S81P / S82P S83P". This is evidence that chassis code is the community's real taxonomy.

### UX worth copying
- Weatherford's **two-lane split** (new off-road vs 25+ yr) and its card badges: status + legal lane + body (e.g. "On the Lot · Off-Road Only · Jumbo Cab").
- Boeki's **feature chip checklist** (4WD / LO-HI / Diff Lock / EL / UL / PTO / PS…) with inactive chips greyed out. Absence is as informative as presence. Also its condition grade with a published legend (4/B, plus green/blue/yellow/red blocks).
- Dyna's **translated auction sheet** and JPN's "Japanese Auction Grade 3.5" plus "Manufactured March 1999". These are verifiable provenance fields.
- Skyline's **arrival tracking** (ship name, port, ETA) and its schema.org Car JSON-LD with KMT units.
- Mini Monsters' **shipping estimator** (ZIP × $/mile) and its explicit "This vehicle is not street legal."
- Showing **both km and mi** (Boeki, Mayberry, Japstar's "92,000 kilometers = 57,166 Miles = avg 2,286 mi/yr").
- Sold archives with prices (Northwest /inventory/sold, Kei Evolution sold archive, JMT sold trucks).

### UX to avoid
- Price fields that hold something else: a deposit (Rocky Mountain), $0 (sold items or JSON-LD), "Contact us" next to a real price, or a "Cleared customs price" in CAD with no USD.
- Status only in prose or ribbons. Status contradictions (AZ: one product in Available + En-Route + Sold).
- Reused URLs whose content changes to a different truck (Mini Trucks Ohio, US Mini Truck Sales). Synthetic paragraph listings with no URL (JMT).
- Stale or copy-pasted JSON-LD (Mars describes a Toyota Estima on a Hijet page) and SEO filler that gets specs wrong (JDM Offroad, Mini Truck Imports, AZ).
- Generic "Body Style: Pickup / Mini Truck" fields that hide the real kei body.
- Hiding price behind contact. Buyers distrust it (Muse FB study); most dealers do show price.

---

## Per-dealer site structure

Format for each dealer: platform · navigation path · how listings are organised · listing layout · status marking · legal labelling · media · contact.

### Shopify
- **Kei Trucks America** (IN): Shopify.
  - Path: Home → "Shop Trucks" (`/collections/us-inventory-trucks`) → product.
  - Organisation: about 10 products, sortable by price, no filters.
  - Listing layout: gallery + body_html spec table (Manufacturer/Brand/Chassis/Odometer (km)/WD/Turbo/AC/PS/Body Type).
  - Status: tag "newarrival", Shopify sold-out state. Legal: separate "State Restrictions for Kei Trucks" blog.
  - Contact: Add to cart + contact page; wholesale page for fleets.
- **minitrucks.net** (JP/US/AU): Shopify.
  - Path: Home → "Buy a mini truck" → Shop all / Mini trucks in Japan / United States / Australia / "Source via auction" → product.
  - Organisation: collections by location; Shopify sort; "Show more"; parts store alongside.
  - Listing layout: gallery + video + metafield spec table (SKU, Make, Model, Variant, Year, Odometer (KM), Bed, Drive, Chassis Number, Features, Location) + FAQ block.
  - Status: InStock / sold. Legal: tags "Street Legal" and "Over 25 Years Old".
  - Contact: Add to cart; RoRo-port delivery note.
- **Sunshine Imports** (TX): Shopify (`template_suffix` "vehicles").
  - Path: Home → Vehicles (`/collections/all`) → product.
  - Organisation: one grid, price sort.
  - Listing layout: short spec list in the description.
  - Status: title/handle prefixes "[JUST LANDED]", "coming-soon-"; sold units stay listed.
  - Contact: checkout disabled for vehicles; contact page.
- **Texas JDM** (TX): Shopify.
  - Path: Home → Vehicles for Sale → Kei Vehicles (`/collections/kei-vehicles`, with make sub-collections DAIHATSU/HONDA/MITSUBISHI…) → product.
  - Other collections: Enthusiast, Postal, Off-Highway.
  - Listing layout: long prose with stock # and TX title/export-docs paragraph; template "requires-contact" (no cart).
  - Legal: "Off-Highway" collection for non-road units.
- **Tokyo Motors DC** (MD): Shopify.
  - Path: Home → Inventory page → sections MINI-TRUCKS / INBOUND IMPORTS / PREVIOUSLY SOLD → product.
  - Listing layout: ALL-CAPS feature title + prose.
  - Status: inbound vs sold sections; 600+ sold products remain in the catalogue.
  - Contact: Inquire page; "Buying Process", "Transport" pages.
- **Skyline Kei Trucks** (TX): Shopify.
  - Path: Home → "In Houston" (`/collections/in-stock-houston`) or "Arriving Soon — RESERVE" → product.
  - Organisation: collections by model (Hijet, Carry, Acty, Sambar, Midget II), Kei Dump Trucks, Kei Vans, Kei SUVs; filters + sort.
  - Listing layout: spec table (Stock #, Year, Make, Model, Odometer km + approx mi, Drivetrain, VIN/Chassis, 25-year rule, arrival ship/ETA) + Car JSON-LD.
  - Status: tag "in-transit", schema PreOrder.
  - Contact: Reserve (deposit), call/text; ZIP-based shipping.
- **JMT Ohio Sales** (OH): Shopify, but trucks live on hand-written pages.
  - Path: Home → Trucks → "Buy a Truck" / "En Route" / "Sold Trucks".
  - Organisation: no products for trucks; each truck is a paragraph + photo strip. Parts collections by chassis code.
  - Status: separate pages. Media: swipe photo strip, YouTube.
  - Contact: call Jacey/Michael.

### WooCommerce / WordPress
- **JPM Mini Trucks** (FL): WooCommerce.
  - Path: Home → MINI TRUCKS → "4WD Mini Trucks" category (or USA Stock / Japan) → product.
  - Organisation: categories by drivetrain, transmission, location; filters; numbered pages; huge parts catalogue.
  - Listing layout: 1 photo, badges ("Free Nationwide Shipping", "Federally Compliant 25-Year Import Exemption"), spec table (Title, Import Compliance, Location, Condition).
  - Contact: "Reserve This Truck" checkout, chat.
- **Japan Car FL** (FL): WooCommerce (Woodmart).
  - Path: Home → Inventory (`/shop/`) with filter by car model (Acty / HiJet / Minicab / Every JoyPop) and make categories → product.
  - Listing layout: pipe-separated headline + prose; attributes Miles / Transmission.
  - Status: "New Arrival" category; sold/pending. Contact: "ORDER A CALL", appointment / video call.
- **Arizona Kei Trucks** (AZ): WooCommerce.
  - Path: Home → All Inventory / Available / Sold / En Route → product.
  - Organisation: flat grid by status page.
  - Status: badges EN-ROUTE / SOLD (conflicting categories). Legal: "Arizona Kei Truck Laws 2025" page. Contact: purchasing page, financing, "Import by request".
- **JP Trade LLC** (FL): WooCommerce.
  - Path: Home → Inventory → product (`/shop/` 404s).
  - Listing layout: Woo attributes (Body Type, Year, Make, Model, Options, Status) + long prep-checklist prose.
  - Contact: WhatsApp / Telegram / email; "JDMBUYSELL Verified Dealer" badges.
- **Mini Truck Imports** (LA): WooCommerce.
  - Path: Home → Inventory / Buy Now (`/shop/`) → product.
  - Listing layout: Woo attributes (Stock #, Year, Vin, Make, Model, Transmission, Options, 2wd/4wd, Miles, KM, Color, Body, Price) + boilerplate.
  - Contact: Buy Now, call. Accessories store alongside.
- **Dakota Mini Trucks** (SD): WooCommerce (Store API locked).
  - Path: Home → FOR SALE (`/home/shop/`) → product. Footer categories: Regular Cabs / Jumbo Cabs / Dumps / Crew Cabs / Vans.
  - Status: "For Sale (USA)" vs "Sold" (sold pages thank the buyer by first name and town). Legal: SD off-road vehicle title.
  - Contact: call/text to deposit; "Ask a question"; plows + accessories upsell.
- **Mini Monsters USA** (UT): WordPress Vehica.
  - Path: Home → Inventory (`/search/?condition=inventory`), status tabs Available / Coming Soon / Reserved / Custom Builds / Sold, "Shop by body style" (Jumbo Cab, HD Dump, Deck Van, Extreme, Cargo Van) → listing.
  - Listing layout: attribute list (Cab Type, Drive Type, Transmission, Package, Title…) + shipping estimator.
  - Legal: "This vehicle is not street legal." Contact: financing, loan calculator, favourites.
- **US Mini Truck Sales** (MI), **Mini Trucks Ohio** (OH), **Mile High Mini Trucks** (CO): one WordPress Pods + FacetWP "minitruck" plugin vendor.
  - Path: Home → "Buy a Truck" (`/buy/`) → inventory post.
  - Listing layout: "PRICE / MAKE / MODEL / MILEAGE / VIN / STOCK NO / WARRANTY / TITLING" + long feature prose.
  - New units only; "RESERVE THIS…" forms; snow plow upsell.
  - Slugs get reused for different trucks.
- **JDM Connection** (AB): WordPress car-dealer theme (listing CPT).
  - Path: Home → All Listings (`/listings/`) with type filters (SUV, Sedan, Truck…) and 13 selects → listing.
  - Listing layout: car fields (Body, KM, Fuel, Year, Transmission, Drive Type, Engine Size, Stock Number) + map.
  - Contact: purchase-to-order agreement forms; auction vehicles.
- **Japan Canada Motors** (AB): WordPress Elementor listings.
  - Path: Home → Inventory with categories Mini Trucks / JDM Vehicles / JDM Sold → listing.
  - Listing layout: "CAR DETAILS" table (Year, Make, Model, Trim, Body, Trans, Kilometer, Engine, Color, Drivetrain "2WD / 4WD / 2H / 4H / 4L", Features, Warranty).
  - Contact: form + call.
- **Manga Auto Import** (QC): WordPress vehicle CPT (FR/EN).
  - Path: Home → Inventaire/Inventory with make facet and counts → used-vehicle page.
  - Contact: Japan auction service, rust-proofing service.
- **B-Pro Auto JDM Imports** (AB): WordPress.
  - Path: Home → Inventory → "Dealer stock" (`/jdm-dealer-inventory/`) with sort + pages → unit.
  - Listing layout: Japan-side wholesale feed; "Cleared Customs Price" CAD; Vehicle Specifications (Mileage, Chassis, Model Year YYYY-MM, Repairs, Steering) + options + similar-auction blocks.
  - Contact: PLACE DEPOSIT ($1,000), call/text/WhatsApp.

### Wix
- **Rocky Mountain Mini Trucks** (UT): Wix Stores.
  - Path: Home → TRUCKS (`/inventory`) → product-page.
  - Organisation: one grid mixing trucks and filters/parts.
  - Listing layout: description with spec lines.
  - Status: price = $500 refundable deposit for arriving trucks.
  - Contact: Add to cart (deposit) / Buy now; "How it works" page.
- **G&R Imports** (MO): Wix Stores.
  - Path: Home → Truck Inventory (`/japanese-mini-trucks-for-sale`) → product-page.
  - Organisation: grid; parts store dominates.
  - Listing layout: SEO name with internal code [#GRLF8], "Features / Transmission / Color / Mileage / Model (chassis code)".
  - Legal: some units "off road use only". Contact: Add to cart, call.
- **Granite State Imports** (NH): Wix.
  - Path: Home → IMPORTS (`/inventory`) → product-page.
  - Status: ribbons IN STOCK / INCOMING / INCOMING-LOWEST MILEAGE / IN STOCK-AUTOMATIC; short spec description.
  - Contact: "Inquire Now", text to schedule.
- **Keitruck.ca** (QC): Wix (French).
  - Path: Home → INVENTAIRE → product-page.
  - Listing layout: SKU = frame number; regular vs cash-promo price.
  - Status: "EN PRÉPARATION À NOTRE ATELIER". Contact: Fairstone financing, phone. Tyres/wheels/suspension store.
- **Motorcycle Warehouse** (OR): Wix.
  - Path: Home → Mini Trucks (`/minitrucks`) → product-page.
  - Organisation: categories RHD Cars / Mini Trucks / Equipment / Trailers; ribbons show mileage.
  - Contact: "Contact us for pricing" despite a listed price.
- **The Import Guys** (WA): Wix.
  - Path: Home → Inventory → `/keitruck` (kei page) → product-page.
  - Organisation: grid with hook ribbons ("Difflock!", "Auto, Like New, AC!").
  - Listing layout: one-line spec + prose.
  - Contact: chat widget (Tidio), toll-free number, zero-down financing; Japanese auction service.

### Squarespace
- **Mars Mini Trucks** (NC): Squarespace pages (not Commerce).
  - Path: Home → Inventory (`/mini-trucks-for-sale`) → page.
  - Listing layout: honest condition prose + "Vehicle Overview & Specifications" block (Chassis, First registered, Drive, Dump, Odometer km/mi, Cab).
  - Contact: text to book a test drive; "No trades". (Stale JSON-LD.)
- **Japan Direct Motors** (SC): Squarespace Commerce.
  - Path: Home → Inventory (`/inventory`) with category filter (KEI Vehicles, Mini Trucks, Coming Soon, by make) → `/inventory/p/<slug>`.
  - Status: title prefixes *PENDING* / *SOLD*. Legal: some "off-road use only".
  - Contact: Add to cart button, financing, FAQ. Mail-Route Vehicles is the main business.

### dealerwebsites.com template (Fun Karz, Northeast Auto Imports, Mud Hog, Kuruma)
- **Path:** Home → VIEW INVENTORY (`/inventory`, Kuruma has a category "MINI TRUCKS AND VANS") → `/<id>/<YEAR-MAKE-MODEL>`.
- **Organisation:** make/model/year/price selects, sort, pages.
- **Listing layout:** "Photo Viewer N Images" + label/value table (Stock NO, VIN, Body Style, Mileage, Engine, Transmission, Drive, Colors, Title Status, Condition) + Comments + Features + inquiry form + long legal disclaimer ("may not conform to EPA/DOT… may not be legal for on-road use").
- **Status:** "* Please call for availability"; sold units removed.
- Fun Karz and Mud Hog add "Mail Carrier Financing"; Mud Hog recruits sub-dealers.

### Carsforsale.com (JDM Car & Motorcycle WA, JDM RHD Car & Motorcycles TN)
- **Path:** Home → CARS FOR SALE with body categories (Pickup, Dump, Box Trucks, Minivans…) + "Washington / Tennessee location inventory" cross-links → `/details/<slug>/<id>`.
- **Organisation:** filters (price, make), sort, 24 per page.
- **Listing layout:** spec table + decoded factory specs; VIN masked; stock encodes lot (SEQUIM).
- **Contact:** form, "Our bank lenders".

### Other platforms
- **Boeki USA** (NJ/NY/WA): custom PHP.
  - Path: Home → location counters ("88 Available in New Jersey / 0 Washington / 0 New York / 0 In Transit") → `/inventory/<state>/<city>/mini-trucks/available` → unit.
  - Organisation: cards with lot # ("[NJ] 459-1"), price or "Ask", grade "4/B", NEW badge; sort; numbered pages.
  - Listing layout: spec table + feature chip checklist + condition legend + Market Price / Shipping / Add-ons tabs.
  - Contact: Finance Now, Request a Quote, Test Drive, phone.
- **Mayberry Mini Trucks** (NC): React SPA + JSON API.
  - Path: Home → Inventory (`/inventory`, paged cards: year model price mileage) → `/inventory/<chassis no>`.
  - Listing layout: Key Specs (Make, Model, Year, Mileage, Colours, Engine, Transmission, Options chips) + Description.
  - Legal: description claims NC street legal. Contact: contact-seller form, YouTube.
- **Weatherford Mini Trucks** (TX): Base44 SPA.
  - Path: nav "Off Road Mini Trucks" (`/Inventory`) vs "25+ Year Trucks" (`/imports`), plus Fleet.
  - Organisation: cards with Category / Status / Transmission filters and "Newest First". Badges: status (On the Lot / Arriving Soon), lane (Off-Road Only / 25+ Year Import), body (Standard / Jumbo Cab / Dump Truck / Deck Van); "Expected: <date>".
  - No detail page: "Inquire" → `/Contact?truck=<stock>` with an intended-use question.
- **Northwest Mini Trucks** (WA, bonus): Rails dealer-site product.
  - Path: Home → AVAILABLE / INCOMING / SOLD INVENTORY, body links (Trucks, Dump Trucks, Vans, SUVs, Campers) → `/inventory/<slug>`.
  - Organisation: 210 cards on one page; make/year/body/transmission GET filters; sort.
  - Listing layout: feature-list title, spec table, Car JSON-LD. Contact: financing (J.J. Best).
- **Kei Truck King** (NY): Duda.
  - Path: Home → KEI INVENTORY (paged, 6 pages, cards with Stock/VIN/Drive/Odometer/Features) → post.
  - Listing layout: "Label: value" block, "+ Tax" price, as-is policy.
  - Contact: form; service, parts, plows, custom builds; "Kei Truck Info" per make.
- **Krazy Kei Imports** (WI): GoDaddy Online Store.
  - Path: Home → Vehicles for Sale → categories (Kei Trucks / Kei Vans / Kei Cars In Stock, Clearance Vehicles) → product.
  - Listing layout: dash-bullet spec, strike-through sale price. Contact: BUY NOW / ADD TO CART, delivery quote, swag store.
- **Dyna Motor Imports** (AB): Next.js.
  - Path: Home → INVENTORY ("21 trucks in stock") with make/body filters, sort, pages; A-Stock Garage.
  - Card badges: IN STOCK / IN TRANSIT / PENDING SALE / JUST ARRIVED / SUPERCHARGED.
  - Listing layout: spec summary + translated auction sheet. Contact: $1,000 deposit, enquiry, Canada-wide rail shipping table.
- **Superior Pulses / buykeitrucks.ca** (SK): client-rendered custom site.
  - Path: Home → Shop Sale Inventory (`/inventory`, filters + sort; cards "HARVEST SALE Available Dump Bed 2000…" / "SOLD") → unit.
  - Extras: "Find Your Truck" quiz. Contact: call/text the agent, request info.
- **Kei Evolution** (FL): custom.
  - Path: Home → INVENTORY (AVAILABLE / BUILD IN PROGRESS / SOLD badges) and a Sold Archive → unit with Car JSON-LD and a restoration-focused spec table.
- **Speedworks NW** (WA): dealer-site vendor.
  - Path: Home → INVENTORY (`/all-inventory/`) → `/vehicles/<id>-<year>-<make>-<model>/`.
  - Mixed classic stock. Contact: credit application, test-drive scheduling.
- **JPN Auto Import** (NC): DealerCenter-style ASP.
  - Path: Home → Inventory / On the Way / Sold → `default.asp?page=xPreOwnedInventoryDetail&id=`.
  - Organisation: make/model/price selects; sort.
  - Listing layout: Manufactured month, Model Code, Chassis, Auction Grade; YouTube per unit.
  - Contact: Podium chat, Get a Quote, Value Your Trade, Schedule Test Drive. (The CSV listed it as behind Cloudflare; no challenge seen in either curl or Browser Farm.)
- **Street Legal Mini Trucks** (PA) and **Japstar Imports** (NJ): one shared custom PHP CMS.
  - Path: Home → USA INVENTORY (cards "Available for $X" / "SALE PENDING", with payment methods) or JAPAN STOCK → `detail/index.php?p=<id>`.
  - Listing layout: DETAILS / AFTERMARKET / IMPERFECTIONS / ABOUT / FINANCING blocks + walk-around video. Auction/import service.
- **SamuraiTrucks** (AB): custom static on Cloudflare.
  - Path: Home → Vehicles For Sale (`/vehicles`, AVAILABLE / ARRIVING / SOLD badges) → `/vehicle/<slug>`. `/kei-trucks/` is actually the parts index.
  - **Browser Farm hit a Cloudflare "Just a moment…" 403 there.**
- **JDM Offroad** (WA): custom dealer site.
  - Path: Home → INVENTORY / SOLD → `/inventory/<make>/<model>/<id>/`.
  - Organisation: body type filter; "CALL FOR PRICE" common; "*Fees not disclosed".
  - **curl gets a 403; Browser Farm works.**
- **Duncan Imports** (VA): Dealer.com.
  - Path: Home → JDM Inventory / "Mini-Truck Inventory" (`?bodyStyle=Mini-Truck`) / Bargain Barn → `/used/<Make>/<slug>.htm`.
  - Organisation: sort; pages.
  - Contact: schedule form, buying-sight-unseen and 3rd-party inspection pages.
  - **curl gets a 403 (Akamai-style); Browser Farm works.**

### Not sampled (site notes)
- **Kei Import Parts:** Shopify parts store organised "Shop by truck" (Sambar/Acty/Carry/Hijet/Minicab).
- **West Shore Auto:** ShopSite parts store organised by model and chassis code (Hijet S80P S81P / S82P S83P), plus Cushman and Kia Towner parts.
- **KeiCraze Customs:** Squarespace with 5 pages (Home, About, Service/Parts, Contact, FAQs) and no listings.
- **Star Truck Enterprises:** Blogger with posts from 2008 to 2015.
- **SODO Moto:** WordPress listings with make/model/year filters, In Stock / Incoming pages; no kei in stock.
- **Mini Trucks South:** WordPress critical error (HTTP 500).
- **JDM Drive:** TLS certificate invalid.
- **Tiki Bunny, Lancaster:** no site.
- **Kei Truck Direct, Mini Truck Depot:** skipped by instruction.
