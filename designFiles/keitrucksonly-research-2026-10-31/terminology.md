# Kei truck terminology glossary (keitrucksonly.com)

> Raw-source copy (2026-10-31, agent:listing-sampler). Relative paths such as `raw/`, `work/`, `samples.jsonl` and `tools/` refer to the scratchpad capture dir `/private/tmp/claude-501/-Users-sumanth-Desktop-shuttlementorWorkspace/97f6b0eb-7d40-40c0-bc46-9a51ccf5690a/scratchpad/listings/` (not in the repo).

Purpose: vocabulary to drive categorisation, structured search filters, facet values and text-search synonyms for an aggregator of US kei (Japanese mini) truck dealer listings.

Researched 2026-10-31. Every row cites a source URL. "unverified" means no source located during this pass confirmed it (often widely repeated in dealer copy but not confirmed). Where sources conflict, the conflict is noted.

**Recommendation key**
- **FILTER**: a structured field on the listing record (filterable/sortable). Example: `make`, `drivetrain`.
- **FACET**: a value inside a FILTER field. Example: `drivetrain = 4WD`.
- **SYNONYM**: text-search only (map to a canonical term or field value; do not create a field).

Abbreviations: 2WD = two-wheel drive (rear), 4WD = four-wheel drive, MT/AT = manual/automatic, EFI = electronic fuel injection.

---

## Top 15 terms for search/categorisation

1. **Make** (Suzuki, Daihatsu, Honda, Subaru, Mitsubishi, Mazda, Nissan, Toyota) — every listing has one; rebadges mean make alone is ambiguous, so pair with model.
2. **Model** (Carry, Hijet, Acty, Sambar, Minicab, Scrum, Clipper/NT100, Pixis Truck) — the primary browse axis on every competitor site (keitruckus.com, jdmbuysell.com).
3. **Chassis code** (e.g. DA16T, S210P, HA4, KS4, U62T) — many listings give it instead of a year; it encodes generation and usually 2WD/4WD; jdmbuysell browses by it (`/for-sale/suzuki/carry/da62t/`).
4. **Platform / "built by"** (Suzuki Carry platform, Daihatsu Hijet platform, Mitsubishi Minicab platform) — normalises rebadges (Scrum = Carry, Pixis/Sambar 2012+ = Hijet, NT100 2013+ = Carry) so a Carry search finds Scrums.
5. **Model year / build month** — buyers filter by year and the 25-year import rule counts from build month.
6. **Drivetrain** (2WD/RWD vs 4WD/4x4) — the single most-asked spec; competitor collections ("4x4 Kei Trucks").
7. **Transmission** (5MT, 4MT, 3AT, 4AT, CVT) — keitruckus has an "Automatic Kei Trucks" collection; automatics are scarcer and sought.
8. **Body type** (standard truck, Jumbo/extended cab, dump, van, fire truck, scissor dump, crane, box/refrigerated) — competitor collections ("Kei Dump Trucks", "Kei Fire Trucks", "Kei Vans").
9. **Diff lock / rear locker** — key off-road feature; appears in titles as "difflock", "dif lock", "DL".
10. **Hi/Lo transfer vs extra-low (EL/crawler) gear** — two different low-range systems, often confused; buyers want either.
11. **Mileage with unit (km vs mi)** — Japanese odometers read km; listings mix units; must store unit or normalise.
12. **Title status** (title in hand, state titled, off-road/OHV title, bill of sale only, import docs only) — determines registrability; keitruckus surfaces "title status".
13. **Road legality class** (street-legal registration, restricted/low-speed, off-road only) — varies by state; new (non-25-year) trucks are off-road only.
14. **A/C** (air conditioning) — commonly absent on older base trims; keitruckus lists it as an attribute; frequent title keyword ("AC", "A/C", "cold air").
15. **Supercharger / turbo** (Sambar SC, Hijet turbo, Carry turbo) — enthusiast-sought, price-relevant, usually in titles.

---

## 1. Category-level and community vocabulary

| Term | Definition | Applies to | Aliases / misspellings | Rec. | Source |
|---|---|---|---|---|---|
| Kei truck | Japanese "light" (kei) class pickup: 660 cc max engine (since 1990), small external dimensions, 350 kg rated load. | All makes | keitruck, kei-truck, kei tora, keitora, 軽トラ (keitora), K-truck, kei pickup | SYNONYM (site category) | https://keitruckus.com/ ; https://en.wikipedia.org/wiki/Kei_truck |
| Mini truck | US dealer/regulatory term for kei trucks (state statutes use "mini truck"/"minitruck"). | All | minitruck, mini-truck, mini trucks, Japanese mini truck, JMT | SYNONYM | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ ; https://minitruckdepot.com/japanese-mini-trucks-makes-models/scissor-dump-mini-trucks/ |
| Kei / kei car | Japanese light-vehicle class (軽自動車 kei jidōsha); "kei" alone often used for any kei vehicle. | All | K car, keicar, kei jidosha | SYNONYM | https://en.wikipedia.org/wiki/Kei_truck |
| Kei van | Van body on the same chassis (Every, Hijet Cargo/Atrai, Acty Van/Street, Sambar Van/Dias, Minicab Van). Chassis code ends in V/W/C/B rather than T/P. | All | mini van, kei-van, cargo van, Every, Atrai | FACET (body_type = van) | https://keitruckus.com/ |
| JDM | "Japanese Domestic Market" — built for Japan, not export. Used loosely as "imported from Japan". | All | Japan-spec, J-spec | SYNONYM | https://keitruckus.com/ |
| Japan-spec / RHD | Right-hand drive Japanese-market configuration; all imported used kei trucks are RHD. | All imports | right hand drive, RHD | SYNONYM (optionally FACET steering) | https://en.wikipedia.org/wiki/Kei_truck |
| Kei plate (yellow plate) | Yellow Japanese registration plate denoting kei class; sometimes shown in listing photos. | Japan-registered | yellow plate | SYNONYM | https://keitruckus.com/ |
| 660 cc limit | Kei engine displacement cap since 1990 (550 cc 1976-1990, 360 cc before). Used to date trucks ("550 cc era"). | All | 660cc, 550cc, 360cc | FILTER (engine_cc) | https://en.wikipedia.org/wiki/Mazda_Scrum ; https://keitruckus.com/ |
| 350 kg rated load | Japanese legal payload for kei trucks (~770 lb). | All | payload, max load 350kg | SYNONYM | https://keitruckus.com/ |
| Kei truck vs UTV | Community comparison; kei trucks marketed as an enclosed-cab UTV alternative. | All | side-by-side, SxS, UTV | SYNONYM | https://keitruckus.com/ |
| Landed cost | Total cost of import (purchase + shipping + duty + fees). | Imports | landed price | SYNONYM | https://keitruckus.com/ |
| Kei truck builds | Modified kei trucks (lift, tyres, campers); subreddit r/KeiTruckBuilds. | All | lifted kei, kei camper | SYNONYM | https://gummysearch.com/r/KeiTruckBuilds |
| Kei camper | Camper shell/body on kei truck. | All | truck camper, mini camper | FACET (body_type = camper) | https://keitruckus.com/ |

---

## 2. Makes, models, rebadges and misspellings

Platform owner is the useful normalisation key: three platforms (Suzuki Carry, Daihatsu Hijet, Mitsubishi Minicab) plus the in-house-only Honda Acty and pre-2012 Subaru Sambar.

| Term (model) | Definition / platform | Years (truck) | Aliases / misspellings | Rec. | Source |
|---|---|---|---|---|---|
| Suzuki Carry | Suzuki kei truck; own platform. | 1961-present | Carrie, Cary, Carry Truck, Suzuki Carry Truck, Suzulight Carry (1961-65), Super Carry (large cab, 2018-) | FACET (model) | https://en.wikipedia.org/wiki/Suzuki_Carry |
| Super Carry | Large-cabin (extended cab) Carry variant, released May 2018. (Also an unrelated export name for older Carrys.) | 2018-present | Super Carry X, Carry big cab | FACET (body/cab = extended) + SYNONYM to Carry | https://en.wikipedia.org/wiki/Suzuki_Carry |
| Daihatsu Hijet | Daihatsu kei truck; own platform; donor for Toyota Pixis Truck and Subaru Sambar (2012+). | 1960-present | Hi-Jet, HiJet, Hi Jet, Hijet Truck, Highjet, Hijett | FACET (model) | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Honda Acty | Honda kei truck; never rebadged. Production ended April 2021. | 1977-2021 | Akty, Acti, Activ, Acty Truck, Honda Acty Truck | FACET (model) | https://en.wikipedia.org/wiki/Honda_Acty |
| Honda T360 / TN360 / TN-III / TN7 | Acty predecessors (T360 1963-67 first Honda production vehicle; TN series to 1977). Very rare in US listings. | 1963-1977 | T-360, TN-360, TN III | FACET (model) | https://en.wikipedia.org/wiki/Honda_Acty (TN noted as predecessor); T360 dates unverified this pass |
| Subaru Sambar | Subaru kei truck; rear-engine in-house design 1961-Feb 2012; rebadged Daihatsu Hijet from April 2012. | 1961-present | Sumbar, Sambur, Samber, Sambar Truck, Subaru Sambar Truck | FACET (model); also derive `platform` from year | https://en.wikipedia.org/wiki/Subaru_Sambar |
| Mitsubishi Minicab | Mitsubishi kei truck; own platform to Feb 2014, then rebadged Suzuki Carry (DS16T). | 1966-present | Mini Cab, Mini-Cab, MiniCab, Minicab Truck | FACET (model) | https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| Mazda Scrum / Autozam Scrum | Rebadged Suzuki Carry/Every. Launched June 1989 under Mazda's Autozam channel (DG41/DH41), later sold as Mazda Scrum. | 1989-present | Scrum Truck, Autozam, AZ Scrum, Scrumb | FACET (model) with platform = Carry | https://en.wikipedia.org/wiki/Mazda_Scrum |
| Nissan Clipper (U71T) | Rebadged Mitsubishi Minicab. | 2003-2012 | Clipper Truck | FACET (model) platform = Minicab | https://en.wikipedia.org/wiki/Nissan_Clipper |
| Nissan NT100 Clipper | Name from 2012 facelift of U71T (Minicab), then from 2013 rebadged Suzuki Carry (DR16T); renamed "Clipper Truck" in 2024. | 2012-present | NT100, NT-100, NT 100 Clipper, Clipper | FACET (model) platform by year | https://en.wikipedia.org/wiki/Nissan_Clipper |
| Toyota Pixis Truck | Rebadged Daihatsu Hijet (from Dec 2011, S201 then S500 series). | 2011-present | Pixis, Toyota Pixis | FACET (model) platform = Hijet | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Eunos (Mazda) | Mazda sales channel; no evidence found of a Eunos-badged kei truck. Treat "Eunos Scrum" as unverified/likely error; map to Mazda Scrum. | — | Eunos | SYNONYM (to Scrum) — unverified | https://en.wikipedia.org/wiki/Mazda_Scrum (lists Autozam only) |
| Ford Pronto / Pronto PR-Z | Export rebadges of Carry (Taiwan etc.); occasional in listings. | various | — | SYNONYM | https://en.wikipedia.org/wiki/Suzuki_Carry |
| Daihatsu "Atrai" | Passenger/van sibling of Hijet Cargo; Sambar Dias Wagon 2009+ is a rebadged Atrai. | 1990s- | — | FACET (body = van) | https://en.wikipedia.org/wiki/Subaru_Sambar |
| Suzuki Every | Van sibling of Carry (split off Dec 1982). | 1982- | Every Van, Every Wagon | FACET (body = van) | https://en.wikipedia.org/wiki/Suzuki_Carry |
| Honda Acty Street / Vamos | Acty van / passenger van names. | 1988- | Street, Acty Van | FACET (body = van) | https://en.wikipedia.org/wiki/Honda_Acty |
| New (2020s) mini trucks | Current-production units sold new by US dealers (e.g. "2024 Daihatsu HD Dump") — under 25 years, so sold off-road-only. | 2020s | new mini truck, brand new kei | FACET (condition = new) + FACET (legal = off-road only) | https://minitruckdepot.com/product/hddumppto-manual-white ; https://keitruckus.com/ |

---

## 3. Chassis codes and generations

### 3.0 Conventions

| Term | Definition | Applies to | Aliases | Rec. | Source |
|---|---|---|---|---|---|
| Chassis code (型式 katashiki) | Factory model code identifying generation/body/drive (e.g. DA16T, S210P). Often given instead of year. Sometimes prefixed by an emissions prefix ("GD-TT2", "EBD-DA16T") which should be stripped. | All | model code, type code, chassis model, frame model, katashiki | FILTER (chassis_code) | https://www.jdmbuysell.com/learn/subaru/sambar/ ; https://carfromjapan.com/cheap-used-subaru-sambar-truck-for-sale?page=5 |
| Frame number (車台番号) | Unique vehicle ID = chassis code + hyphen + serial, e.g. "S210P-0044678", "KS4-123456". JDM vehicles have no 17-character VIN; the frame number serves as VIN on US titles/import forms. Parse prefix before hyphen into chassis_code. | All JDM | chassis number, VIN, serial, frame # | FILTER (frame_number, derived chassis_code) | https://www.jdmbuysell.com/learn/subaru/sambar/ ; https://www.jdmbuysell.com/learn/subaru/sambar/tv1/ |
| Emissions prefix | Letters before the chassis code on Japanese docs (e.g. "GD-", "LE-", "EBD-", "V-", "Q-"), denoting emission regulation era. | All | — | SYNONYM (strip in parser) | https://carfromjapan.com/cheap-used-subaru-sambar-truck-for-sale?page=5 (example "GD-TT2"); era meaning unverified |
| Body suffix: T | Suzuki/Mazda/Nissan/Mitsubishi code suffix T = truck (DA16T, U62T, DG52T). | Carry, Scrum, Clipper, Minicab | — | SYNONYM (parser rule) | https://en.wikipedia.org/wiki/Nissan_Clipper ; https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| Body suffix: V / W | V = van, W = wagon (Suzuki/Mitsubishi/Nissan). Daihatsu: P = truck, C = panel van, V = glazed van, W = Deck Van. | All | — | SYNONYM (parser rule) | https://en.wikipedia.org/wiki/Daihatsu_Hijet ; https://en.wikipedia.org/wiki/Nissan_Clipper |
| Rebadge suffix (J/U) | Subaru Sambar on Hijet base uses J suffix (e.g. S510J); Toyota Pixis assumed U suffix (S510U). | Sambar 2012+, Pixis | — | SYNONYM | https://en.wikipedia.org/wiki/Subaru_Sambar (S510J caption); Pixis "U" unverified |
| 2WD/4WD pairs | Codes come in pairs: Carry DA (2WD)/DB or DD (4WD); Hijet S200/S210, S500/S510 (x00 2WD, x10 4WD); Acty odd 2WD/even 4WD (HA3/HA4, HA8/HA9); Sambar 1 = 2WD, 2 = 4WD (TT1/TT2); Minicab U61 2WD/U62 4WD. | All | — | Derive FACET (drivetrain) from code | https://en.wikipedia.org/wiki/Honda_Acty ; https://www.jdmbuysell.com/learn/subaru/sambar/ ; https://minitrucktalk.com/threads/daihatsu-s80-81-82-83.18146/ |

### 3.1 Suzuki Carry (and Mazda Scrum / Nissan NT100 / Mitsubishi Minicab DS16T rebadges)

| Code | Years | Drive | Engine | Notes | Rec. | Source |
|---|---|---|---|---|---|---|
| ST30/ST40 etc. (7th gen) | 1979-1985 | 2WD/4WD | LJ50 2-stroke, F5A | Rare in US. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry |
| DA71T / DA41T / DB41T (8th gen) | 1985-1990 | DA 2WD / DB 4WD | F5A/F5B 550 cc | 550 cc era. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry |
| DA51T / DB51T | 1990-1991 | 2WD / 4WD | F6A 657 cc | 8th-gen facelift moved to 660 cc. Note: many US dealers loosely say "DA51T" for any 1990s Carry. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry |
| DC51T / DD51T (9th gen) | 1991-1999 | DC 2WD / DD 4WD | F6A | DD51T is the most common 25-year-eligible 4WD Carry. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry |
| DA52T / DB52T (10th gen) | Jan 1999-~2001 | 2WD / 4WD | F6A (EFI; turbo at launch, dropped May 2000) | Semi-cab-over, new safety rules. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry ; https://www.jdmbuysell.com/for-sale/suzuki/carry/da52t/?page=3 |
| DA62T | ~2001-2002 (sources differ) | 2WD/4WD in one code | K6A (timing chain, DOHC) | K6A switch Sept 2001 per Wikipedia. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry ; https://www.jdmbuysell.com/for-sale/suzuki/carry/da62t/?page=2 |
| DA63T | ~2002-2013 (start year conflicts 2002/2003) | 2WD/4WD in one code | K6A | Rebodied May 2002. | FACET | search summary of amayama/minitrucks.net (conflicting); https://en.wikipedia.org/wiki/Suzuki_Carry |
| DA65T | 2005-2013 | 2WD/4WD | K6A | "Carry FC" short-wheelbase, agricultural option (Nov 2005). | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry |
| DA16T (11th gen) | Aug 2013-present (facelift Dec 2025) | 2WD/4WD in one code | R06A 658 cc | Current; under 25 years → off-road only in many states. | FACET | https://en.wikipedia.org/wiki/Suzuki_Carry |
| Mazda/Autozam Scrum DG41T/DH41T | 1989-1990 | DG 2WD / DH 4WD | F5B 550 cc | Rebadged Carry. | FACET | https://en.wikipedia.org/wiki/Mazda_Scrum |
| Scrum DG51T/DH51T | 1990-1999 | 2WD / 4WD | F6A | Mirrors Carry DA/DC51T-DD51T. | FACET | https://en.wikipedia.org/wiki/Mazda_Scrum |
| Scrum DG52T/DH52T, DG62T, DG63T, DG16T | 1999-present | — | F6A/K6A/R06A | Mirror Carry codes with DG/DH prefix. | FACET | pattern inferred — unverified |
| Nissan NT100 Clipper DR16T | 2013-2024 (Clipper Truck 2024-) | 2WD/4WD | R06A | Rebadged Carry DA16T. | FACET | https://en.wikipedia.org/wiki/Nissan_Clipper |
| Mitsubishi Minicab DS16T | Feb 2014-present | 2WD/4WD | R06A | Rebadged Carry; trims "Truck M", "Truck G". | FACET | https://en.wikipedia.org/wiki/Mitsubishi_Minicab |

### 3.2 Daihatsu Hijet (and Toyota Pixis / Subaru Sambar 2012+)

| Code | Years | Drive | Engine | Notes | Rec. | Source |
|---|---|---|---|---|---|---|
| S65P/S66P (6th gen) | 1981-1986 | 2WD/4WD | AB20/AB55 550 cc | Jumbo introduced 1983; Climber with LSD. | FACET | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| S80P / S81P (7th gen) | 1986-1990 | S80 2WD / S81 4WD | EB 550 cc 3-cyl | | FACET | https://minitrucktalk.com/threads/daihatsu-s80-81-82-83.18146/ ; https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| S82P / S83P | 1990-1994 | S82 2WD / S83 4WD | EF 660 cc | Some S83P listings say full-time 4WD, others part-time with diff lock — verify per listing. | FACET | https://minitrucktalk.com/threads/daihatsu-s80-81-82-83.18146/ ; https://response.jp/database/model/1692 |
| S100P / S110P (8th gen) | 1994-1999 | S100 2WD / S110 4WD | EF 660 cc | Climber (S110P). | FACET | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| S200P / S210P (9th gen) | 1999-2007 | S200 2WD / S210 4WD | EF-SE/VE | Example frame "S210P-0044678". | FACET | https://en.wikipedia.org/wiki/Daihatsu_Hijet ; https://samuraitrucks.pages.dev/blog/daihatsu-hijet-s200p-vs-s210p-differences |
| S201P / S211P | Dec 2007-2014 | 2WD / 4WD | KF-VE | Base for Pixis Truck (Dec 2011) and Sambar (Apr 2012). | FACET | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| S500P / S510P (10th gen) | Sept 2014-present | 2WD / 4WD | KF-VE (CVT option Dec 2021) | Jumbo 2014-; current. | FACET | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Sambar S201J/S211J, S500J/S510J | 2012-present | 2WD/4WD | KF | Rebadged Hijet. | FACET | https://en.wikipedia.org/wiki/Subaru_Sambar (S510J); S201J unverified |
| Pixis Truck S201U/S211U, S500U/S510U | 2011-present | 2WD/4WD | KF | Rebadged Hijet. | FACET | suffix unverified |

### 3.3 Honda Acty

| Code | Years | Drive | Engine | Notes | Rec. | Source |
|---|---|---|---|---|---|---|
| TA/TB/TC (1st gen) | 1977-1988 | 2WD; 4WD from 1983 | EH 545 cc 2-cyl | | FACET | https://en.wikipedia.org/wiki/Honda_Acty |
| HA1 / HA2 | 1988-1990 | HA1 2WD / HA2 4WD | E05A 547 cc | 550 cc era. | FACET | https://en.wikipedia.org/wiki/Honda_Acty |
| HA3 / HA4 | 1990-1999 | HA3 2WD / HA4 4WD | E07A 656 cc (EFI from 1996) | 4WD lost the AT after 1990. Attack trim has ultra-low gears + rear diff lock. | FACET | https://en.wikipedia.org/wiki/Honda_Acty ; https://www.jdmbuysell.com/learn/honda/acty/ha4/ |
| HA5 | to 1999 | — | E07A | "Crawler" special order. | FACET | https://en.wikipedia.org/wiki/Honda_Acty |
| HA6 / HA7 | 1999-2009 | HA6 2WD / HA7 4WD (one source does not split) | E07Z | Mid-engine semi-cab; 25-year eligible from 2024. | FACET | https://en.wikipedia.org/wiki/Honda_Acty ; https://www.jdmbuysell.com/learn/honda/acty/ha7/ |
| HA8 / HA9 | Dec 2009-Apr 2021 | HA8 2WD / HA9 4WD | E07Z 658 cc | Truck only. | FACET | https://en.wikipedia.org/wiki/Honda_Acty |

### 3.4 Subaru Sambar (in-house, rear-engine)

| Code | Years | Drive | Engine | Notes | Rec. | Source |
|---|---|---|---|---|---|---|
| K71 (truck) / K81 (van) | 1973-1982 | 2WD; 4WD optional 1980 | EK21/EK23 | | FACET | https://en.wikipedia.org/wiki/Subaru_Sambar |
| KR (KR1/KR2 etc.) | 1982-1990 | 2WD/4WD | EK23 544 cc | "Sambar Try". | FACET | https://en.wikipedia.org/wiki/Subaru_Sambar |
| KS3 / KS4 (KV3/KV4 van) | 1990-1999 (one source 1998) | KS3 2WD / KS4 4WD (conflict: some say KS4 = supercharged; a 1997 KS4 listed as 2WD) | EN07 4-cyl 658 cc; EN07Y supercharged | | FACET | https://www.jdmbuysell.com/learn/subaru/sambar/ ; https://oiwagarage.co/pages/subaru-sambar-mini-trucks |
| TT1 / TT2 (TV1/TV2 van, TW1/TW2 Dias Wagon) | Feb 1999-Feb 2012 | TT1 2WD / TT2 4WD | EN07 (SC 58 PS) | Last in-house Sambar; "farm-road Porsche". | FACET | https://www.jdmbuysell.com/learn/subaru/sambar/ ; https://en.wikipedia.org/wiki/Subaru_Sambar |

### 3.5 Mitsubishi Minicab and Nissan Clipper (Minicab-based)

| Code | Years | Drive | Engine | Notes | Rec. | Source |
|---|---|---|---|---|---|---|
| U11T/U12T/U14T/U15T/U18T/U19T (4th gen) | 1984-1991 | 2WD/4WD | G23B, 3G81 550 cc | | FACET | https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| U41T / U42T (5th gen; also U43/U44) | 1991-1999 | U41 2WD / U42 4WD | 3G83 657 cc; 4A30 | Trims TU, TD, TL; "Type V" 1996. | FACET | https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| U61T / U62T (6th gen; also U68/U69) | 1999-2014 | U61 2WD / U62 4WD | 3G83 | | FACET | https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| Nissan Clipper U71T / U72T | 2003-2013 | U71 2WD / U72 4WD | 3G83 | Rebadged Minicab U61/U62; U72T not on Wikipedia — unverified. | FACET | https://en.wikipedia.org/wiki/Nissan_Clipper |
| Minicab MiEV / Clipper EV | 2011- / 2024- | 2WD | electric | Rare in US. | FACET (fuel = electric) | https://en.wikipedia.org/wiki/Nissan_Clipper |

---

## 4. Trims, grades and body types

| Term | Definition | Makes / years | Aliases / misspellings | Rec. | Source |
|---|---|---|---|---|---|
| KC | Suzuki Carry base/work grade (DA63T/DA16T era); often with AC/PS ("KC Air Con Power Steering", "KCエアコン・パワステ"). | Carry, Scrum/NT100/Minicab equivalents | KC grade | FACET (trim) | https://satjapan.com/new-cars/mk_suzuki/md_carry_truck/suzuki-carry-truck-kc ; https://en.wikipedia.org/wiki/Suzuki_Carry (KC 4WD caption) |
| KX | Upper Carry grade (keyless entry, body-colour bumpers, newer: LED lights). | Carry DA16T (also earlier) | — | FACET (trim) | https://satjapan.com/new-cars/mk_suzuki/md_carry_truck/suzuki-carry-kx |
| KU | Older Carry grade seen on 1990s-2011 listings; equipment unverified (commonly described as basic/no-AC). | Carry DD51T-DA63T | — | FACET (trim) — unverified | https://www.goo-net-exchange.com/usedcars/SUZUKI/CARRY_TRUCK/ |
| KA / KE / FC / Farm | Other Carry grades seen; "Carry FC" = short-WB DA65T with agricultural spec option (農繁 "nouhan" farm-spec). | Carry | 農繁, nouhan, farm spec | FACET (trim) — KA/KE/nouhan unverified | https://en.wikipedia.org/wiki/Suzuki_Carry |
| Farm Master / Field Master | **SUPERSEDED: not a real trim** (Muse FB study, and absent from all 51 dealer pages). Dealers say "Farming Package" instead (see "Terms observed on dealer sites"). | — | — | do not use; map "farm package" as a SYNONYM | Muse 2026-10-31; dealer captures |
| Tokutei (特定) | Possibly "special-spec/special-purpose" designation in Japanese listings. Not confirmed. | — | — | SYNONYM — unverified | none found |
| Special / Tokubetsu shiyō (特別仕様) | Japanese "special edition" grade label. | All | special edition, limited | SYNONYM | https://minitrucks.net/products/copy-of-2022-daihatsu-hijet-jumbo-4wd (dealer use of "special edition") |
| Jumbo | Daihatsu extended/high-roof cab with small rear window and reclining seats (since 1983; current "Jumbo Extra"). Suzuki equivalent = Super Carry; Acty had "Big Cab" (1st gen). | Hijet 1983-; Pixis/Sambar "Grand Cab" equivalent unverified | Jumbo cab, extended cab, ext cab, big cab, Jumbo Extra, Super Carry | FACET (cab_type = extended) | https://en.wikipedia.org/wiki/Daihatsu_Hijet ; https://www.j-spec.com.au/lineup//Hijet_Truck/S500/id-415 |
| Regular cab / standard cab | Normal kei cab. | All | std cab, standard | FACET (cab_type = regular) | https://minitruckdepot.com/models/suzuki-regular-cab/ |
| High roof | Taller cab roof option. | Hijet 9th/10th gen | high-roof, hi-roof | FACET (cab_type) or SYNONYM | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Climber | Daihatsu off-road Hijet: off-road tyres, LSD (1980s), later rear diff lock + hi/lo transfer (S110P). | Hijet 1981-1999 | Hijet Climber | FACET (trim) | https://en.wikipedia.org/wiki/Daihatsu_Hijet ; https://jdmsupply.com/sale/6YPl88/1999-daihatsu-hijet-climber |
| Attack | Honda Acty 4WD grade with ultra-low forward/reverse (UL/UR) gears and rear diff lock (HA4); HA7 Attack has diff lock (no extra-low mentioned). | Acty HA4, HA7 | Acty Attack, Attack Hunter (special edition) | FACET (trim) | https://en.wikipedia.org/wiki/Honda_Acty ; https://keitruckus.com/ |
| SDX / SDX2 / SDX-Hi | Acty "Super Deluxe" grades. | Acty | Super DX | FACET (trim) | https://en.wikipedia.org/wiki/Honda_Acty |
| Town / TOWN | Acty comfort grade. | Acty | — | FACET (trim) | https://en.wikipedia.org/wiki/Honda_Acty |
| STD / Standard | Base grade label (Acty, Hijet). | Many | std | FACET (trim) | https://en.wikipedia.org/wiki/Honda_Acty |
| Crawler (Acty HA5) | Special-order Acty variant. | Acty to 1999 | — | FACET (trim) | https://en.wikipedia.org/wiki/Honda_Acty |
| TC / TB / TC Limited / TC Pro | Sambar truck grades. | Sambar KS/TT | — | FACET (trim) — TC Limited cited by keitruckus; TB/TC meanings unverified | https://keitruckus.com/ |
| Dias / Dias Classic / Dias Wagon | Sambar upmarket van/passenger grades (not truck). | Sambar KV/TV/TW | — | FACET (trim, body = van) | https://www.jdmbuysell.com/learn/subaru/sambar/ |
| Super Charger | Supercharged engine grade (Sambar EN07Y; also older Hijet/Minicab 3G81). | Sambar 1990-2012 etc. | supercharger, S/C, SC, super-charged, スーパーチャージャー | FACET (induction = supercharged) | https://www.jdmbuysell.com/learn/subaru/sambar/ ; https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| Turbo | Turbocharged engine (Carry DA52T launch; Hijet KF-DET; Minicab 3G83T). | various | turbocharged, TB | FACET (induction = turbo) | https://en.wikipedia.org/wiki/Suzuki_Carry ; https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Truck M / Truck G | Minicab DS16T grades. | Minicab 2014- | — | FACET (trim) | https://en.wikipedia.org/wiki/Mitsubishi_Minicab |
| Dump / dump bed | Tipping bed; electro-hydraulic or PTO-driven. | All makes | dumper, tipper, tipping bed, dump truck, ダンプ | FACET (body_type = dump) | https://minitruckdepot.com/japanese-mini-trucks-makes-models/daihatsu-hijet-dump/ ; https://keitruckus.com/ |
| Scissor dump | Dump bed raised on a scissor lift (up to ~6 ft 5 in) for high-tip unloading. Rare. | Carry, Hijet | scissor lift dump, high lift dump, 深ダンプ? (unverified) | FACET (body_type = scissor dump) | https://minitruckdepot.com/japanese-mini-trucks-makes-models/scissor-dump-mini-trucks/ |
| PTO dump | Dump hydraulics driven by engine power take-off; truck must be parked to raise. | Hijet HD Dump; older units | PTO | FACET (dump_type = PTO) | https://minitruckdepot.com/product/hddumppto-manual-white |
| Electric/hydraulic dump | Electro-hydraulic pump (battery-powered) dump. | Carry "Sturdy Dump", Hijet | electric dump, hydraulic dump, e-dump | FACET (dump_type = electric) | https://minitruckdepot.com/?p=3137 |
| HD Dump / LD Dump | US dealer names (MiniTruckDepot) for heavy-duty/low-deck new Hijet dumps. | New Hijet | low dump, heavy duty dump | SYNONYM → dump | https://minitruckdepot.com/japanese-mini-trucks-makes-models/daihatsu-hijet-dump/ |
| Super Dump / Low dump / Deep dump | Japanese dump bed variants (super/low-floor/deep-bed). | Carry, Hijet | 深ダンプ, 低床ダンプ | SYNONYM → dump — unverified | none found |
| Fire truck (shōbō) | Kei fire engine (pump, hose reel); keitruckus has a "Kei Fire Trucks" collection. | All makes | fire engine, shobo, shobosha, 消防車, pump truck, firetruck | FACET (body_type = fire truck) | https://keitruckus.com/ ; https://en.wikipedia.org/wiki/Kei_truck |
| Crane / kei crane | Truck with small loader crane. | Various | crane truck, ユニック (unic) | FACET (body_type = crane) — unverified in sources | https://keitruckus.com/ ("Special bodies" section) |
| Refrigerated / freezer box | Insulated reefer box. Acty "FD" grade = refrigerated box. | Acty FD; various | reefer, freezer, 冷凍車, cold box | FACET (body_type = refrigerated) | https://en.wikipedia.org/wiki/Honda_Acty |
| Box / panel truck / aluminium van box / wing | Enclosed cargo box on truck chassis (aluminium "wing" with side-opening panels). | Various | box truck, van body, alumi van, wing body | FACET (body_type = box) — wing unverified | https://keitruckus.com/ ("Special bodies") |
| Tanker / sprayer | Tank or agricultural sprayer body. | Various | spray truck | FACET (body_type = tank/sprayer) — unverified | none found |
| Deck Van | Hijet van with short open rear bed (W suffix). | Hijet S8x+ | deck van | FACET (body_type = deck van) | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Panel van | Windowless van (Daihatsu C suffix). | Hijet etc. | cargo van | FACET (body_type = van) | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Cab-over / semi-cab-over | Seats above front axle (cab-over) vs front wheels ahead of seats (semi-cab). Carry went semi-cab in 1999; DA16T; Acty HA6+; Sambar 2012+ semi. | All | cabover, COE, semi cab | SYNONYM | https://en.wikipedia.org/wiki/Subaru_Sambar ; https://en.wikipedia.org/wiki/Suzuki_Carry |
| Flatbed / standard bed | Normal open bed with drop sides. | All | flat deck, flat bed | FACET (body_type = standard truck) | https://en.wikipedia.org/wiki/Daihatsu_Hijet |

---

## 5. Drivetrain, transmission and engine

| Term | Definition | Makes / years | Aliases / misspellings | Rec. | Source |
|---|---|---|---|---|---|
| 4WD | Part-time selectable 4WD on most; some (S83P, Sambar) described as full-time/on-demand. | All | 4x4, 4wd, AWD (misused), four wheel drive, 4 wheel drive, 四駆 | FILTER drivetrain; FACET 4WD | https://keitruckus.com/ ; https://minitrucktalk.com/threads/awd-vs-4wd.20380/ |
| 2WD / RWD | Rear-wheel drive only. | All | 2wd, rear wheel drive, two wheel drive, FR, RR (Sambar) | FACET (drivetrain = 2WD) | https://keitruckus.com/ |
| Part-time 4WD | Driver-selected 2H/4H/4L; not for dry pavement. | Carry DD51T etc. | selectable 4WD, 2H/4H/4L | FACET (4wd_type = part-time) | https://texasjdm.com/products/1999-suzuki-carry-4x4-copy |
| Full-time / Realtime / on-demand 4WD | Permanent or automatic 4WD (Acty "Real Time 4WD", Sambar full-time). | Acty, Sambar, Hijet S83P (some) | Realtime 4WD, full time 4x4 | FACET (4wd_type = full-time) | https://keitruckus.com/ ; https://en.wikipedia.org/wiki/Subaru_Sambar |
| Hi/Lo transfer | Two-speed transfer case (4H/4L). | Carry DD51T/DB52T, Hijet, Minicab | hi-lo, high/low, 4lo, 4L, low range, H/L | FACET (low_range = hi/lo) | https://minitrucks.net/blogs/news/suzuki-carry-4wd-explained-axle-lock-diff-lock-extra-low-and-hi-lo-gears |
| Extra low (EL) / crawler / super low gear | Additional gear below 1st in the manual gearbox, instead of a hi/lo transfer case (Carry); Acty "UL/UR" ultra low. | Carry 4WD (some), Acty Attack | EL, X-low, extra-low, super low, SL, granny gear, crawler, ultra low, UL | FACET (low_range = extra-low) | https://minitrucks.net/blogs/news/suzuki-carry-4wd-explained-axle-lock-diff-lock-extra-low-and-hi-lo-gears ; https://en.wikipedia.org/wiki/Honda_Acty |
| Diff lock | Locking rear differential; usually only in low range. | Carry, Hijet (Climber, Jumbo Extra), Acty Attack, Minicab | difflock, dif lock, diff-lock, locker, rear locker, rear diff lock, DL, デフロック | FACET (diff_lock = yes) | https://minitrucks.net/blogs/news/suzuki-carry-4wd-explained-axle-lock-diff-lock-extra-low-and-hi-lo-gears ; https://minitrucktalk.com/posts/118817/ |
| Axle lock / hub lock | Front-hub engagement on Carry (separate from diff lock). | Carry | axle lock, free-wheel hubs | SYNONYM | https://minitrucks.net/blogs/news/suzuki-carry-4wd-explained-axle-lock-diff-lock-extra-low-and-hi-lo-gears |
| LSD | Limited-slip differential (Hijet Climber 1980s). | Hijet | limited slip | SYNONYM (map to traction aid) | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| 5MT / 4MT | 5- or 4-speed manual. | All | manual, stick, 5-speed, 5spd, M/T | FILTER transmission; FACET manual | https://www.jdmbuysell.com/learn/subaru/sambar/ |
| 3AT / 4AT | 3- or 4-speed automatic. | Most, often 2WD | auto, automatic, A/T | FACET (automatic) | https://keitruckus.com/ |
| CVT | Continuously variable (Hijet 2021+; early Sambar). | Hijet S500P, Sambar 1990s | — | FACET (automatic) | https://en.wikipedia.org/wiki/Daihatsu_Hijet |
| Carb vs EFI | Carburettor vs fuel injection; EFI on F6A from ~1990s Carry, Acty E07A from 1996. | All | carbureted, fuel injected, FI, EGI, EMPi | FACET (fuel_system) or SYNONYM | https://en.wikipedia.org/wiki/Honda_Acty ; https://www.jdmbuysell.com/learn/subaru/sambar/ |
| Engine codes | F5A/F5B/F6A/K6A/R06A (Suzuki); EB/EF/KF (Daihatsu); E05A/E07A/E07Z (Honda); EK/EN07 (Subaru); 3G81/3G83 (Mitsubishi). | per make | — | FILTER (engine_code) or SYNONYM | Wikipedia model pages above |
| PS (power steering) | Many base trucks lack PS; often listed with AC as "AC/PS". | All | P/S, power steering, パワステ | FACET (feature) | https://satjapan.com/new-cars/mk_suzuki/md_carry_truck/suzuki-carry-truck-kc |
| A/C | Air conditioning. | All | AC, aircon, air con, エアコン | FACET (feature) | https://keitruckus.com/ |
| Mid-engine / rear-engine | Engine under seats/bed: Acty mid-engine, Sambar (in-house) rear-engine. | Acty, Sambar | MR, RR | SYNONYM | https://en.wikipedia.org/wiki/Subaru_Sambar |

---

## 6. Subaru Sambar specific

| Term | Definition | Years | Aliases | Rec. | Source |
|---|---|---|---|---|---|
| Rear-engine (RR) | Engine behind the rear axle; unique to in-house Sambar among kei trucks. | 1961-2012 | RR, rear engine | SYNONYM | https://en.wikipedia.org/wiki/Subaru_Sambar |
| 4-wheel independent suspension | Four-wheel independent suspension since the 1st gen. | 1961-2012 | 4WI, IRS | SYNONYM | https://en.wikipedia.org/wiki/Subaru_Sambar |
| EN07 four-cylinder | 658 cc inline-4 ("Clover 4"), naturally aspirated or supercharged EN07Y. | 1990-2012 | 4 cylinder, 4-cyl, Clover 4 | SYNONYM | https://en.wikipedia.org/wiki/Subaru_Sambar ; https://kuruma-news.jp/post/862058/2 |
| Akabō / red cap (赤帽) | Sambar built for the Akabō light-freight drivers' cooperative: reinforced EN07 (crank bearings, rings, seals, platinum plugs). Not JA (agricultural co-op) — the task's "JA-spec" link is unverified; treat "red cap" as Akabō only. | 1980s-present (4-cyl only to 2012) | Akabo, Akabou, red cap, redcap, 赤帽 | FACET (trim = Akabo) | https://bestcarweb.jp/feature/column/430581?prd=2 ; https://bestcarweb.jp/?p=2392 |
| "Farm-road Porsche" (農道のポルシェ) | Nickname for 5th/6th gen Sambar: RR + inline-4. | 1990-2012 | noudou no porsche | SYNONYM | https://kuruma-news.jp/post/862058/2 |
| TT vs TV vs TW | TT = truck, TV = van, TW = Dias Wagon (6th gen); numeral 1 = 2WD, 2 = 4WD. | 1999-2012 | — | SYNONYM (parser) | https://www.jdmbuysell.com/learn/subaru/sambar/ |
| Post-2012 Sambar | Rebadged Hijet (3-cyl, front/mid engine) — not the "real" Subaru Sambar to enthusiasts. | 2012- | "Daihatsu Sambar" | Derive FACET platform = Hijet | https://en.wikipedia.org/wiki/Subaru_Sambar |

---

## 7. Bed and body accessories

| Term | Definition | Applies to | Aliases | Rec. | Source |
|---|---|---|---|---|---|
| 3-way gates (三方開) | Bed with both sides and tailgate folding down. Standard on most kei trucks. | All | three-way dropside, 3 way bed, fold down sides, drop sides | SYNONYM (FACET bed_type = 3-way if needed) | https://en.wikipedia.org/wiki/Daihatsu_Hijet (S60 "three-way dropside") |
| Bed liner / bed mat | Plastic/rubber bed protection. | All | bedliner, bed mat | SYNONYM | dealer usage; unverified |
| Gate guard / headache rack | Guard frame behind cab protecting rear window. | All | cab guard, rear window guard, 鳥居 (torii) | SYNONYM — unverified | none found |
| Bed length (ft) | Carry/Hijet bed ~6.5 ft (approx.). | All | long bed | FILTER optional — unverified | https://minitruckdepot.com/?p=3137 ("longest bed" claim) |
| Detachable bed | DA63T notable for a removable load bed (claim). | Carry DA63T | — | SYNONYM — single source | search summary (minitrucks.net) |
| Tonneau / canopy / cargo cover | Bed cover/shell. | All | canopy, topper, shell, camper shell | SYNONYM | https://keitruckus.com/ (Campers) |

---

## 8. Condition, import and legal

| Term | Definition | Applies to | Aliases / misspellings | Rec. | Source |
|---|---|---|---|---|---|
| 25-year rule | Federal (NHTSA) exemption: vehicles ≥25 years old (counted from build month/year) can be imported without FMVSS compliance (49 CFR 591.5(i)(1)). Governs import, not street legality. | All imports | 25 year exempt, 25-yr, classic import | FILTER (derived: import_eligible) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ ; https://www.jdmbuysell.com/learn/topics/25-year-rule/ |
| 21-year EPA rule | EPA Code E emissions exemption for ≥21 years old in original configuration (40 CFR Part 85). | Imports | Code E | SYNONYM | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Build month / manufacture date | Month the truck was built — the date the 25-year rule counts from. Often unknown on old kei (no build plate); inferred from first registration. | All | production date, MFG date | FILTER (build_date) | https://keitruckus.com/ |
| HS-7 | DOT/NHTSA import declaration; Box 1 = ≥25 years, FMVSS-exempt. | Imports | DOT HS-7, HS7 | SYNONYM (FACET doc "import docs") | https://hmr-website.pages.dev/blog/japanese-kei-truck-import-registration (secondary) |
| EPA 3520-1 | EPA import declaration; Code E = age exemption. | Imports | 3520, EPA form | SYNONYM | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| CBP 7501 | Customs Entry Summary — proof of legal entry; used by DMVs to title. Duty 2.5% (trucks of kei class reportedly classed as cars, not 25% "chicken tax" — not verified this pass). | Imports | 7501, entry summary, customs release | SYNONYM | https://oiwagarage.co/blogs/honda-acty-maintenance-guide/kei-import-loophole-compliance-checklist (search snippet; page 429'd) |
| Export certificate (輸出抹消仮登録証明書) | Japanese "export deregistration (provisional) certificate" issued by MLIT; lists make, model, frame number, displacement, first registration, deregistration date. Primary ownership doc for DMV titling. | Imports | export cert, Japanese title, deregistration certificate, 抹消登録証明書 (masshō tōroku shōmeisho) | SYNONYM | https://www.customs.go.jp/english/c-answer_e/extsukan/5502_e.htm ; https://www.wcshipping.com/blog/japanese-export-certificate-deregistration-guide-for-us-imports |
| Kei notification certificate (軽自動車届出済証) | Kei vehicles are "notified" to the Light Motor Vehicle Inspection Organisation rather than registered with MLIT; deregistration document differs (名義/返納証明書). | Kei imports | — | SYNONYM — unverified | none confirmed |
| English translation | Translated export certificate supplied with import docs. | Imports | translated title | SYNONYM | https://floridatranslate2-0.pages.dev/japanese-export-certificate-translation-dmv |
| Auction grade | Japanese auction-house overall score (e.g. 2, 3, 3.5, 4, 4.5, 5, S); not standardised across houses. | Auction-sourced | grade 4, auction score | FILTER (auction_grade) | https://www.jdmbuysell.com/learn/topics/auction-grading/ ; https://satjapan.com/car-blog/japanese-auction-grading-system/ |
| Grade R / RA | Repaired/accident-history grade (RA = minor repaired accident); meanings vary by source. | Auction | R grade, accident repaired | FACET (auction_grade) | https://carfromjapan.com/article/industry-knowledge/used-car-auction-grade-basic-information |
| Interior grade (A-D) | Separate interior letter grade. | Auction | — | FACET | https://satjapan.com/car-blog/japanese-auction-grading-system/ |
| Auction sheet | Inspector sheet with grade, damage map (A1-A3 scratches, U1-U3 dents, etc.) and comments. | Auction | auction report, inspection sheet | SYNONYM | https://support.carfromjapan.com/hc/en-us/articles/203799939-Overview-of-Japanese-AA-Inspection-Sheet |
| Kilometres (km) | Japanese odometer unit; listings may say "km", "kms", "Japan km", or convert to miles. | All imports | km, kms, kilometers, kilometres, JPN km | FILTER (mileage + unit) | https://www.jdmbuysell.com/ad/1995-subaru-sambar-truck-b-pro-1524076/ |
| Miles (mi) | US mileage unit (some dealers convert). | All | mi, miles | FILTER (mileage + unit) | — |
| Odometer rollback / unverified mileage | Mileage not verifiable; some sellers note "TMU" (true mileage unknown). | All | TMU, mileage exempt | SYNONYM — unverified | none found |
| Frame rust | Corrosion of frame/chassis, common on snow-region Japan trucks. | All | rust, rusty frame, rot | SYNONYM (condition keyword) | dealer usage — unverified |
| Undercoating | Rust-proofing applied to underside. | All | undercoated, rustproofed, Fluid Film | SYNONYM | dealer usage — unverified |
| Title in hand | Dealer holds a US title. | US listings | clean title, titled, title on hand | FACET (title_status) | https://keitruckus.com/ ("title status") |
| State titled | Titled in a specific state (affects transfer). | US | — | FACET (title_state) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Off-road only / OHV title | Titled/registered as off-highway vehicle; not road-registrable in e.g. Texas. New (<25-yr) trucks are off-road only. | US | off road use only, OHV, ORV, off highway, farm use only, UTV registration | FACET (legal_status = off-road only) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ ; https://keitruckus.com/ |
| Street legal | Road-registrable in some states (e.g. Alaska, Texas from June 2025, Virginia, Vermont from July 2026). | US | road legal, street-legal, plated | FACET (legal_status = street legal) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Legal with limits / restricted | Road use only under speed limits (FL ≤35 mph, LA ≤55 mph, no interstates in KY/NE/OK etc.). | US | low speed, 35 mph roads | FACET (legal_status = restricted) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ ; https://keitruckus.com/ |
| No road use (prohibited) | States refusing registration (GA, ME, NY, RI new regs). | US | banned | FACET (legal_status by state) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Low-speed vehicle (LSV) | Federal class (20-25 mph, <3,000 lb GVWR, FMVSS 500); some kei trucks registered this way. | US | LSV, NEV | FACET (registration_class) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Farm truck registration | Kei registered as farm vehicle (Vermont Act 153; PA farm exemption). | US | farm plate, ag exempt | FACET (registration_class) | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Grandfather letter (PA) | Pennsylvania on-road registration via 1 Dec 2021 letter; non-transferable. | PA | — | SYNONYM | https://www.jdmbuysell.com/learn/topics/kei-truck-us-legality/ |
| Engine swap | Non-original engine; may break EPA Code E and CA/WA registration. | All | swapped, replacement engine | SYNONYM | https://hmr-website.pages.dev/blog/japanese-kei-truck-import-registration (single source) |
| Shaken (車検) | Japanese periodic inspection; "shaken remaining" seen on Japan-side listings. | Japan | JCI | SYNONYM — unverified | none found |

---

## 9. Sources blocked / not reached

| Source | Result |
|---|---|
| old.reddit.com (r/keitruck, r/kei) | Blocked for the fetch tool ("unable to fetch from old.reddit.com"). No Reddit content used directly. |
| Facebook groups (/groups/<id>/about) | No public group "about" pages surfaced in search; not fetched. |
| japancardirect.com ("Minitruck Options") | HTTP 403. |
| oiwagarage.co (blog, incl. chassis-code table) | HTTP 429 rate-limited; only search-snippet content used. |
| jdmbuysell.com/for-sale/kei-trucks/ (filter taxonomy) | Timeout; learn/ pages fetched fine. |
| minitrucktalk.com | Not fetched directly; only search-result snippets used. |
| Japanese Wikipedia (chassis codes for Scrum etc.) | Not fetched; Scrum DG52T+ codes left unverified. |

---

## Terms observed on dealer sites

Source: one listing plus the inventory index of each of 51 dealers, captured 2026-10-31 through The Browser Farm. Captures are in `raw/<slug>/`; per-dealer detail is in `site-patterns.md` and `field-inventory.md`. Counts are dealers using the term (out of 51) and are approximate.

**Corrections from the Muse Facebook study** (`wiki/inbox/2026-10-31-muse-facebook-marketplace.md`, 306 FB trucks). These supersede rows above:
- **"Farm Master / Field Master" is not a factory trim.** Neither Muse nor any dealer page uses it. Dealers say **"Farming Package"** (Weatherford, US Mini Truck: "Hijet Low Dump Farming Package") or "farm truck". Drop the unverified row in section 4. Use `farm package` as a text synonym only.
- **The second digit of the chassis code means 4WD:** HA3/HA4, TT1/TT2, KS3/KS4, S100P/S110P, S200P/S210P, S500P/S510P, U41T/U42T, U61T/U62T, DC51T/DD51T. This was confirmed on dealer pages: Mars S110P is 4WD, Rocky Mountain S83P is 4WD, Superior DB52T is 4WD, and JMT and West Shore organise parts by these codes.
- **"Mini truck" means two things.** In US Facebook usage it also means domestic compact pickups (S-10, Ranger, Mighty Max), so the 151K-member "Mini Truck Marketplace" group is not kei. Every dealer here uses "mini truck" to mean kei, but search must require a kei make, model or chassis signal before it trusts "mini truck".
- **New 2020s off-road units are a separate price market**: Muse median $27,375; dealer samples $24.5k–$34.9k, against about $7k–$16k for 25-year units. Dealers label them with words that never appear on 25-year units: "Off-Road Use Only", "EPA certified", "Made by Toyota", "CVT", "Farming Package", "THOR package", "pre-order".

### A. Category, filter and nav labels dealers use

| Term (variants seen) | Meaning | Applies to | Dealers (≈n) | Recommendation | Source |
|---|---|---|---|---|---|
| Mini Trucks / Japanese Mini Trucks / Minitruck(s) | Kei trucks (dealer usage is always kei) | all | ~40 | SYNONYM → category `kei truck` (guard: mini truck alone ≠ kei) | boekiusa.com, grimports.com, mayberryminitrucks.com |
| Kei Trucks / Kei Vehicles / KEI Truck | Same | all | ~25 | SYNONYM | skylinekeitrucks.com, texasjdm.com/collections/kei-vehicles |
| Kei Vans / Deck Van / Cargo Van / Microvan | Van-bodied kei, separate from trucks | Hijet/Atrai, Every, Sambar Dias, Acty Street/Van, Minicab Bravo | ~15 | FACET body=van / deck_van | minimonstersusa.com, krazykeiimports.com, jpmminitrucks.com |
| Kei Dump Trucks / Dumps / HD Dump / Low Dump / PTO Dump / Scissor Dump (Lift) | Dump bed variants | all makes; HD/Low = Hijet S500/S510 era; PTO = mechanical pump | ~20 | FACET body=dump + sub-facet dump_type {electric, PTO, scissor, low, HD} | weatherfordminitrucks.com, nwminitrucks.com, usminitrucksales.com |
| Jumbo Cab / Jumbo / Super Jumbo / Extended | Extended cab (seat recline, rear storage) | Hijet (Jumbo since S500P; Super Jumbo 1990s), Carry "Super Carry" | ~10 | FACET cab=extended | dakotaminitrucks.com, japstarimports.com |
| Regular Cab / Standard / Straight Truck / Flatbed / Flat Deck | Standard cab + 3-way drop-side bed | all | ~10 | FACET body=standard (default) | keitruckking.com ("Bed: Straight Truck"), minitrucksohio.com ("Standard Straight"), japancanadamotors.ca ("Flat Deck with Drop Sides") |
| Crew Cab | 4-door kei (rare) | Hijet/Carry special builds | 1 | FACET cab=crew | dakotaminitrucks.com |
| Fire Trucks / Fire Unit / Firetruck | Ex-fire-brigade kei (pump, hose reel, lights) | Hijet, Minicab, Carry, Acty | ~10 | FACET body=fire | kei-trucks.com, marsminitrucks.com, samuraitrucks.com |
| Crane / Kei Truck with Crane | Truck with small loader crane | Hijet, Carry | 2 | FACET body=crane | japancar-fl.com |
| Refrigerator / Freezer Mini Truck | Insulated box with refrigeration unit | Clipper, Hijet | 1 | FACET body=refrigerated_box | japancanadamotors.ca |
| Tanker / Lorry Fuel Tanker | Fuel tanker body | Sambar | 1 | FACET body=tanker | jpmminitrucks.com |
| Camper (Sambar/Domingo Camper) | Camper conversion | Sambar, Domingo (kei-plus) | 2 | FACET body=camper | streetlegalminitrucks.com |
| Food Truck | Mobile kitchen conversion | Minicab | 1 | FACET body=food_truck | theimportguys.com |
| Extreme / THOR / Hunter | Dealer upfit packages (lift + AT tires) | new Hijets, 1990s Acty | 3 | TEXT; FACET modified=lifted | minimonstersusa.com, minitrucksohio.com, streetlegalminitrucks.com |
| Farming Package / Farm Package | Dealer/Japanese "farm" spec (diff lock, extra-low, bed mats) | new Hijet; Carry KC Nouhou | 3 | SYNONYM (not a trim facet) | weatherfordminitrucks.com, usminitrucksales.com |
| 4WD Mini Trucks / 2WD Mini Trucks / Automatic Mini Trucks | Drivetrain/transmission collections | all | 1 (JPM) + many filters | FILTER drive, transmission | jpmminitrucks.com |
| 25+ Year Trucks / Over 25 Years Old / 25-year import rule: Eligible / 25+ Year Import | US-import-eligible used unit | ≤ 2001 now | ~10 | FILTER legal_class=import_25yr | weatherfordminitrucks.com/imports, minitrucks.net tags, skylinekeitrucks.com |
| Off Road Mini Trucks / Off-Road Use Only / Not street legal / Off-Highway / OHV / SD Offroad Vehicle Title | New or non-road unit | 2020s Hijet/Carry, some imports | ~10 | FILTER legal_class=off_road | weatherfordminitrucks.com, minimonstersusa.com, dakotaminitrucks.com, texasjdm.com (Off-Highway) |
| Street Legal / 100% STREET LEGAL / Street Legal Mini Truck | Dealer claim of road registrability (state-dependent!) | 25yr units | ~8 | TEXT only; never a hard filter (state-specific) — map to legal_class + state | streetlegalminitrucks.com, kurumaimports.com, mayberryminitrucks.com (NC) |
| USA Inventory / Japan Stock / Mini Trucks in USA / Japan / Australia | Where the unit physically is | multi-origin dealers | 4 | FACET stock_location {US lot, in transit, Japan} | streetlegalminitrucks.com, minitrucks.net, jpmminitrucks.com |
| Available / In Stock / On the Lot / Available Now / For Sale (USA) | Buyable now | – | ~45 | FACET status=available | weatherfordminitrucks.com, dakotaminitrucks.com |
| Arriving Soon / En Route / Incoming / In Transit / Inbound Imports / Coming Soon / Just Landed / On the Way | Pre-sale, on the water or in customs | – | ~20 | FACET status=arriving (+ ETA) | skylinekeitrucks.com, azkeitrucks.com, tokyomotorsdc.com, jpnautoimport.com |
| Reserved / Pending / Sale Pending / *PENDING* | Deposit taken | – | ~10 | FACET status=pending | japandirectmotors.com, streetlegalminitrucks.com |
| Sold / Sold Archive / Previously Sold / JDM Sold | Gone (kept for comps) | – | ~30 | FACET status=sold (exclude from default search, keep for price history) | nwminitrucks.com/inventory/sold, keievolution.com |
| Build in Progress / Custom Builds / A-Stock Garage | Restomod/project units | – | 3 | FACET status=build / body=custom | keievolution.com, minimonstersusa.com, dynamotorimports.com |
| Clearance Vehicles / Harvest Sale / Bargain Barn | Discount campaigns | – | 3 | TEXT; price_type=sale | krazykeiimports.com, buykeitrucks.ca, duncanimports.com |
| Mail Route Ready / Mail Carrier Financing / Postal Vehicles | RHD vehicles for US rural mail carriers (adjacent market) | RHD SUVs/vans, sometimes kei | 4 | Exclude unless kei; TEXT | japandirectmotors.com, funkarz.net, texasjdm.com |

### B. Title and spec tokens on dealer listings

| Token (variants) | Meaning | Applies to | Seen at (≈n) | Recommendation | Source example |
|---|---|---|---|---|---|
| 2Hi-4Hi-4Lo / 2H-4H-4L / 2H – 4H – N – 4Low / 4 Low and 4 High / LO/HI / High-Low Transfer Case / 2 Speed Transfer-Case / Dual Range | Two-speed transfer case (true low range) | Carry DA/DB/DD, Hijet, Minicab, Clipper (not Acty, not Sambar) | ~15 | FACET low_range=transfer_case | nwminitrucks.com, buykeitrucks.ca, japancanadamotors.ca, boekiusa.com |
| Ex Low 1 / EL / Extra Low / Super Low | Extra-low crawler 1st gear in place of a transfer case | Acty (Attack/SDX 4WD), Sambar 4WD, Hijet Climber | ~6 | FACET low_range=extra_low_gear | mayberryminitrucks.com, boekiusa.com |
| UL / UR / Ultra-Low first / Ultra-Low reverse | Acty Attack's ultra-low 1st and reverse | Acty Attack (HA4/HA7) | 2 | FACET low_range=extra_low_gear; SYNONYM "Attack" | streetlegalminitrucks.com, boekiusa.com chips |
| Diff Lock / Dif-Lock / Difflock / Locking rear differential / Rear diff lock / Axle Lock | Rear differential lock | Attack, Climber, HD/Farm Hijets, many 4WD | ~12 | FILTER diff_lock | mayberryminitrucks.com, jdmrhdcarandmotorcycles.com, milehighminitrucks.com |
| Hub Lock | Manual locking front hubs | some 4WD | 1 (chip) | FACET (rare) | boekiusa.com |
| Push-button 4WD / Selectable 4WD / FULLTIME 4WD / RealTime 4WD / 4×4/2×4/4wd Auto | 4WD engagement type | Carry/Hijet push-button; Acty RealTime; Hijet "Extra" full-time | ~8 | FACET 4wd_type {part_time, full_time, auto} | mc-warehouse.com, jpnautoimport.com, dakotaminitrucks.com |
| 4WD / 4X4 / AWD / 4 Wheel Drive | Four-wheel drive (AWD = Honda wording) | – | ~48 | FILTER drive | everywhere |
| 5MT / 5 Speed / 5-Sp Manual / 5 SPD MANUAL / MT / 4-Speed (Attack) / 3AT / AT / CVT / Automatic CVT | Gearbox | – | ~48 | FILTER transmission {manual, automatic, cvt} + gears | everywhere |
| EFI / Fuel Injected / FI / Carbureted | Fuel system (EFI ≈ late 1990s+) | – | ~10 | FACET fuel_system | tokyomotorsdc.com, jpmminitrucks.com |
| Twin Cam / DOHC / EF-SE / EF-VE / EFNS / EF / F6A / K6A / E07A / E07Z / EN07 / 3G83 | Engine codes / variants | Hijet EF family; Carry F6A/K6A; Acty E07A/Z; Sambar EN07; Minicab 3G83 | ~15 | FACET engine_code (secondary); SYNONYM | jptradeusa.com, theimportguys.com, nwminitrucks.com |
| Supercharger / Supercharged / Turbo | Forced induction | Sambar SC (EN07 S/C), Carry Turbo, Hijet Atrai turbo | ~5 | FILTER forced_induction | weatherfordminitrucks.com, texasjdm.com, dynamotorimports.com |
| PS / P/S / Power Steering | Power steering | late 90s+ | ~15 | FILTER power_steering | nwminitrucks.com |
| AC / A/C / Heat & A/C / Air Conditioner / "no A/C from factory" | Air conditioning | – | ~30 | FILTER ac {yes,no,unknown} | granitestateimports.com, marsminitrucks.com |
| PW / AW / ABS / SRS / Airbag / Keyless / Push button start | Comfort/safety extras (new units) | mostly 2010s+ | ~6 | FACET extras | boekiusa.com chips, dakotaminitrucks.com |
| RHD / Right Hand Drive / Factory RHD | Steering side (≈ all) | all imports | ~15 | DEFAULT; TEXT | funkarz.net |
| Climber | Hijet 4WD extra-low/diff-lock grade | Hijet S81P–S110P | 4 | FACET trim | marsminitrucks.com, theimportguys.com, tokyomotorsdc.com |
| Attack | Acty 4WD grade with extra-low + diff lock | Acty HA4/HA7 | 6 | FACET trim | jpmminitrucks.com, theimportguys.com, streetlegalminitrucks.com |
| SDX / Super Deluxe / Town / Street / TN | Acty trims (SDX = up-spec; Town = 2001+ comfort; Street = van) | Acty | 6 | FACET trim | theimportguys.com, keievolution.com, keitruck.ca ("TN Super Deluxe") |
| KC / KU / KA / KX | Carry grade letters (KC = AC/PS grade, KU = basic, KA, KX = top) | Carry DA63T/DA16T, older KA | 4 | FACET trim | b-pro.ca ("CARRY TRUCK KU"), jdmconnection.ca ("Carry KA") |
| Extra / EXT | Hijet "Extra" grade (full-time 4WD, AT variants) | Hijet S210P | 2 | FACET trim | jpnautoimport.com, jdmcarandmotorcycle.com ("4WD EXT") |
| TC / TC Limited / TB / TV / TT / KS3 / KS4 | Sambar codes/trims (TT = truck, TV = van) | Sambar | 4 | FACET chassis/trim | theimportguys.com ("Sambar TC Limited"), b-pro.ca ("SAMBAR TRUCK TB") |
| Made by Toyota | New Hijet marketing (Daihatsu is a Toyota subsidiary) | 2020s Hijet | 3 | TEXT (noise); signals new unit | usminitrucksales.com, minitrucksohio.com |
| Deposit / Reserve / $500 refundable deposit / PLACE DEPOSIT / RESERVE THIS TRUCK — $1,000 DEPOSIT | Hold mechanism (often for arriving units) | – | ~8 | FACET price_type=deposit (never as price) | rockymountainminitrucks.com, dynamotorimports.com, b-pro.ca |
| + Tax / Fees not disclosed / Cleared Customs Price / Regular vs Sale / Cash price | Price qualifiers | – | ~8 | FACET price_type + store both prices | keitruckking.com, jdmoffroad.com, b-pro.ca, keitruck.ca |
| Ask / Call for price / Contact us for pricing | Price on request | – | ~4 | price=null + price_type=on_request | boekiusa.com, jdmoffroad.com, mc-warehouse.com |
| Lot # / LOT# / Stock # / STK # / SK-1032 | Dealer identifiers (Boeki lot = shipment-position) | – | ~30 | FIELD stock_number | boekiusa.com, tokyomotorsdc.com |
| Title in hand / Clean Title / Title Status CLEAN / TITLING Yes / sold with Arkansas title / clean SC title ready to transfer / import documents / export documents | Paperwork status | – | ~25 | FILTER title_status {state title in hand, pending, export docs only, off-road title} + title_state | mayberryminitrucks.com (titleInHand), funkarz.net, japandirectmotors.com, texasjdm.com |
| Auction Grade 3.5 / 4/B / Overall Grade / Interior/Exterior C/C / A1–A3, C1–C3, S1–S3, U | Japanese auction condition grading + damage codes | imports | 3 | FACET auction_grade (numeric) + interior letter | jpnautoimport.com, boekiusa.com, dynamotorimports.com |
| Manufactured March 1999 / First registered February 1998 (Heisei 10) / MODEL YEAR 2002-08 / H18 Month 1 | Build or first-registration month; Japanese era years | imports | 4 | FIELD build_month (drives 25-year eligibility) | jpnautoimport.com, marsminitrucks.com, b-pro.ca, dynamotorimports.com |
| Shaken (JCI) expiry | Japanese inspection expiry (auction sheet) | imports | 1 | TEXT only | dynamotorimports.com |
| Lift kit / 2" lift / 4" lift / 23" all-terrain tires / snorkel / camo / bed liner | US upfits | – | ~10 | FACET modified {lifted, AT tires, paint} | streetlegalminitrucks.com, mudhogminitrucks.com, minitruckheadquarters.com |
| Payload Capacity 350 / 350kg Load Capacity / 770LB Payload | Bed payload | – | 3 | TEXT (constant-ish: 350 kg) | buykeitrucks.ca, tokyomotorsdc.com, kurumaimports.com |
| Restomod / Restored / Frame-off restoration / livery ("Rothmans", "Martini Racing") | Premium restorations | – | 3 | FACET condition=restored | keievolution.com, texasjdm.com |
| Snow plow / Fisher / SnowEx V-Plow / Camso tracks | Winter upfits sold alongside | new units mostly | 5 | FACET accessory | milehighminitrucks.com, dakotaminitrucks.com |

### C. Dealer vs Facebook-seller vocabulary: where they differ

Facebook sources: Muse (306 FB trucks) and our logged-out spot-check (`terminology-facebook.md`, 67 FB + 52 Craigslist examples).

| Concept | Dealer wording | FB / private-seller wording | Implication |
|---|---|---|---|
| Category | "Mini Trucks", "Kei Trucks", "Japanese Mini Trucks" (always kei) | "kei truck", "mini truck" (ambiguous with S-10/Ranger), "key truck" (misspelling, Muse), "Kei mini truck" | Require a kei make/model/chassis signal before trusting "mini truck". Add "key truck" as a synonym. |
| Drive | "4WD" plus the low-range system spelled out ("2Hi-4Hi-4Lo", "High-Low Transfer Case", "Ex Low") | "4x4" (and "44"); low range rarely mentioned (hi/lo 8% per Muse; diff lock 2%) | Dealers are the source for low-range and diff-lock facets. FB listings will mostly be "unknown". |
| Status | Arriving / En route / In transit, Reserved, Sold archive | Almost always "available"; "still available?" handled in messages | Status facets are a dealer-only feature. |
| Price | Fixed asking, "+ tax", deposit, regular vs sale, "Cleared customs price" | "OBO" (10% per Muse, rare in our spot-check), "firm", "no lowballers", "cash only", trades; FB placeholder prices ($1, $123,456) | `price_type` must cover both: dealer qualifiers (deposit, sale, +tax) and private ones (OBO, firm, placeholder→on-request). |
| Paperwork | "Title Status CLEAN", "clean SC title ready to transfer", "import/export documents", "export certificate" | "title in hand", "clean title", "bill of sale only", "registered in <state>" | Same filter, different phrases. Private "no title / bill of sale" is a scam/risk signal. |
| Mileage | Field plus both units ("41,723mi / 67,188km") | Free text "57K miles", "~39,500", "Kmi"; FB mileage field is mostly null | Parser must handle the K suffix and missing units. |
| Chassis code | In title or spec for about 30% of dealers; parts stores organise by it | "Chassis codes almost never in title" (Muse); a few "KS4", "S38P" | Our biggest normalisation lever is deriving the code from the frame number on dealer data. |
| Legality | "25+ Year Trucks", "Off-Road Use Only", "EPA certified", "Street Legal" (claim), state title named | "street legal" (10%), "registered in state", "farm use" | Model legal_class plus title/registration state; never trust "street legal" as a hard filter. |
| Trim/body | Grade names (Attack, Climber, SDX, KU, Jumbo, Super Jumbo), dump type (PTO/scissor/HD/low) | "dump", "jumbo", "fire truck", "lifted" | Dealer data populates trim facets; FB populates upfit/lifted. |
| New units | "Brand New", "Made by Toyota", "CVT", "pre-order", "Farming Package", "THOR" | Rare on FB (n=6, median $27,375) | Keep new units in a separate lane and price index. |
| Seller type | Stock #, financing lenders, shipping tables, ALL-CAPS templates | First-person prose, "selling my…", reviews count | Heuristics for dealer vs private (Muse): financing + shipping + stock # + template format. |

## Facebook vocabulary (summary)

- **Primary source: Muse.** The owner's Muse study (`wiki/inbox/2026-10-31-muse-facebook-marketplace.md`) covers 90 Marketplace searches and 306 complete trucks with attribute mention rates: price 100%, year 98%, 4WD 68%, miles 64%, manual 61%, title (any) 47%, JDM 38%, A/C 31%, km 24%, 660cc 23%, RHD 21%, clean title 17%, street legal 10%, OBO 10%, dump 8%, hi/lo 8%, diff lock 2%.
  - Misspellings: "key truck", HiJet/Hi-Jet/Diahatsu/Hijett, Akty, MiniCab/Mini Cab, Diaz (Dias).
  - FB auto-suffixes such as "2 door truck" and "Microvan" should be stripped.
- **Our logged-out spot-check** (full table in `terminology-facebook.md`) agrees with Muse:
  - Category words "kei" and "mini truck" dominate.
  - "4x4" is the private-seller form and "4WD" the dealer form.
  - Make-only titles ("Mitsubishi kei truck").
  - FB's make dropdown yields "Toyota DAIHATSU HIJET".
  - Placeholder prices: $1 on Craigslist, $123,456 on FB.
  - "No title, bill of sale only".
  - Seller-term noise: cash, trades, firm, "no lowballers".
- **Browser Farm behaviour on Facebook (logged out):**
  - Every load from the 1st to the 15th, across 3 sessions, showed a closable "See more on Facebook" login popup over a fully loaded page (HTTP 200, never a redirect to /login).
  - Search pages give 15 cards with no pagination. Group pages show 1 post. Listing pages are fully readable.
  - Screenshots are useless because of the popup. A "dismiss overlay before screenshot" option would help.
