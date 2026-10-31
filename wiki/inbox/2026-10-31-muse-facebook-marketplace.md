---
date: 2026-10-31
source: agent:muse (Meta AI, owner's connected FB account), relayed by owner
---
Method: 90 Marketplace searches (10 hubs x 300 mi, 9 queries) on 2026-10-31 + public kei-group posts. 699 raw listings → 421 kei-relevant → 306 complete trucks ($2k–$40k). Snapshot of recent (Oct 2026) listings, not a 12-month history. Geography skewed to FL, TX, WA. All % are Muse estimates.

## Corrections to existing pages
- CORRECTION for [[distribution]]: "Mini Truck Marketplace" (~151K) is a DOMESTIC mini truck group (S-10/Ranger), not kei. Same for Minitruckin, MiniTruck'n Network, Mini Truck Nation. Don't target them.
- "mini truck" is polysemous: kei OR US domestic small pickups. Search must require a Japanese make / kei signal when matching "mini truck". Biggest taxonomy risk. ([[search-demand]])
- "Farm Master / Field Master" not found as a factory trim; sellers say "farm truck/farm package". Don't build a filter for it. ([[glossary]])
- Super Carry: 0 in filtered US sample despite Jumbo being common.

## Listing text patterns
- Titles: 51% "Year Make Model"; +4x4/4WD 15%; +Mini Truck 7%; +Kei Truck 4%; +Dump 4%; +Van 4%. Year in 98% of titles. Chassis codes almost never in title. FB auto-appends suffixes ("2 door truck", "Microvan"): strip them.
- Attribute mention rates (306 trucks): price 100%, year 98%, 4WD 68%, miles 64%, manual 61%, title any 47%, JDM 38%, A/C 31%, km 24%, 660cc 23%, RHD 21%, colour 20%, serviced 19%, delivery 19%, registered-in-state 18%, clean title 17%, rust 13%, lift 11%, street legal 10%, OBO 10%, dump 8%, hi/lo 8%, auto 7%, power steering 5%, diff lock 2%, chassis code low single digits.
- FB structured mileage field mostly null; FB condition field coarse. Mileage lives in free text, mixed units.
- Misspellings seen: key truck, HiJet/Hi-Jet/Diahatsu/Hijett, Akty, MiniCab/Mini Cab, Diaz (Dias).

## Prices (Muse estimates)
- ≤2001 trucks median $8,495 (most $6k–$11k). Carry $8,500, Hijet $8,500, Acty $8,000, Sambar $8,600, Minicab $8,000.
- Dump median $10,500 (clearest premium). Jumbo $9,375 (n=8). Van $9,450 (n=19).
- 2022+ new off-road trucks median $27,375 (n=6): a separate market. Don't merge with 1990s prices in the price index.
- Price <$2,000 in a "kei truck" search is almost always parts/accessories. "Call for price" = price-on-request, not $0.

## Data-model implications (Muse)
- 25-year rule runs from build MONTH, not model year: store build month when available.
- Two markets: (A) 1990s–2001 street-legal-era imports, (B) new 2020s off-road Hijets/Carrys.
- Titled state / registered state are search attributes, separate from seller location.
- Mileage: store original reading, unit, converted value, who converted, odometer status (actual/TMU/unknown/not stated).
- Body type first-class: pickup / van / deckvan / dump / scissor dump / fire / box / camper.
- Rebadge expansion: Carry=Scrum(=Clipper/Minicab later); Hijet=Pixis Truck=Sambar 2012+; Sambar TT=truck, TV=van.
- Chassis-code digit convention: HA3/HA4, TT1/TT2, S100P/S110P, S200P/S210P, S500P/S510P, U41T/U42T, U61T/U62T, KS3/KS4: second = 4WD.
- Use-case tags (farm, ranch, hunting/deer lease, orchard, property maintenance) match how buyers search vs UTVs.
- Dealer vs private: no FB flag; infer from financing + shipping + inventory language + spec-list format + cross-posting.

## Community norms / trust
- Price + location in the post, anti-"DM me", reputation checks ("anyone bought from X?"). Hiding price behind contact is distrusted.
- Scam signals: deposit to hold unseen truck, wire/Zelle/CashApp-only, far-below-market price, no title / bill of sale only, "in Japan, pay now" exporters, impersonation accounts, new accounts burst-posting, raffles, unverified transporters, new trucks without "off-road only".
- Top buyer questions: can I register in my state; title; street legal vs off-road; km or miles; 4WD/hi-lo/diff lock; still available; what's it worth; A/C; frame rust; shipping; parts by chassis code; lift/tires; auto vs manual; VIN/title/export paperwork; insurance.

## Groups (FB rounded counts, 2026-10-31)
- Kei Truck Owners 58K (public), Kei Truck Club 52K (private; price+location required, no DM-me, no raffles), Suzuki Carry Kei Truck USA 27K, Daihatsu Hijet mini truck 20K, Suzuki Carry Group 17K, New England Mini Kei 14K, Subaru Sambar Kei Truck USA 13K, Kei Trucks and Vans 9K, KEI Truck Restoration/Repair 7K, Subaru Sambar Group 6K, SAMBAR SQUAD 6K, PNW Kei 4K.
- No flair system; post types: For Sale, Wanted/ISO, Price Check, Interest Check, Parts, Tech Help, Registration Help, Insurance, Transport, Show-off, Meet, Dealer Inventory.

## State snapshots (Muse, from web; verify) → [[state-laws]]
- TX: 25+ yr allowed as miniature vehicles (SB 1816). FL: mini trucks limited to roads posted ≤35 mph. PA: stopped unrestricted road registration Dec 2021 (off-road/farm/antique only). OH: 2025 HB 54 removed mini trucks from motor-vehicle definition; 35 mph roads in opt-in localities. MA: paused 2024 then reversed; codification debated. ME: no road registration; 2026 working group recommended no change.
- Montana LLC registration is a discussed workaround (groups only).
- Import paperwork terms: export/deregistration certificate, CBP 7501, CBP 3461, DOT HS-7, EPA 3520-1, FMVSS.

Full Muse report: pasted in the 2026-10-31 session; Muse offered a machine-readable synonym/chassis-code table (pending).
