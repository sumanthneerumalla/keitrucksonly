# SamuraiTrucks capture (2026-10-31)

Source: Claude in Chrome on the owner's own browser (no Cloudflare block), relayed by the owner. Browser Farm had hit a Cloudflare 403 on /kei-trucks/.

## Site structure
- Vehicle inventory is at `/vehicles` (nav: "Vehicles For Sale"). `/kei-trucks/` and `/kei-vans/` are PARTS catalogues (303 parts, 0 vehicles).
- Parts catalogue groups by chassis code: Carry DA63T/DA16T/DA52T/DA62T; Acty HA6–HA9; Hijet S500P/S510P/S200P/S210P; Sambar TT1/TT2/S201J/S211J; Minicab U61T/U62T/DS16T. Filters make/model/year, price sort.
- `/vehicles`: one page, no pagination, no filters. Sections: In Stock (17, badge AVAILABLE), Coming Soon (6, no badge, section heading only), Recently Sold (11, badge SOLD; public sold archive).
- Card: badge, title, "year • make • km", snippet, price, "View Details" → `/vehicle/<slug>`.
- Mixed inventory: Townace, Nissan Atlas, Vanette, Bongo, Jimny alongside kei trucks.
- "Reserve Now" appears in some titles/slugs only; no deposit or checkout.
- No street-legal/off-road wording. Footer: "Licensed with AMVIC" (Alberta). Canada's import rule is 15 years, not 25.
- Platform: custom/static site, images at `/Images/Vehicles/...` plus an r2.dev bucket, Cloudflare in front, forms via Web3Forms. No JSON-LD or product JSON noted.
- Contact: per-listing "Contact Us About This Vehicle" form; phone 780-533-3303; banner "More vehicles available than listed".

## Terms seen
4X4 HI/LO, HI-LOW 4WD, Hi/Lo range transfer case, Difflock / Factory Difflock, 7 Speed (Ultra Low 1st and Reverse), Farm package, Heavy Duty Dump, Hydraulic Dump, Reefer Unit (Thermo King), Jumbo, Deckvan, Camper unit, 4wd RV, ONE OF ONE, Camso Tracked, Custom Builds, Acty Attack, Mazda Scrum-badged Carry. Prices CAD, often "Contact for Price". Km only; field label "Mileage / Hours". Typos like "27.000 km".

## Sample listing
https://samuraitrucks.com/vehicle/2002-suzuki-4wd-camper-unit-reserve-now
Spec table labels: Make Suzuki · Model Carry · Year 2002 · Chassis DA63T · Mileage / Hours 93,000 · Drive 4WD · Transmission Manual · Engine 660cc K6A · Colour White. Badge AVAILABLE, price "Contact for Price", 6 photos, no video. Description is a conversion pitch (coilovers, tracks for ice fishing, 14" alloys); no condition, grade, paperwork, legal status, location or warranty.
