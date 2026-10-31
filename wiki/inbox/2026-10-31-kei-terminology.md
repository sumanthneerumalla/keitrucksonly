---
date: 2026-10-31
source: agent:listing-sampler
---
Glossary of kei vocabulary for categorisation and search: about 165 community/reference terms plus dealer-site labels and title tokens. Full detail is in designFiles/keitrucksonly-research-2026-10-31/terminology.md, with Facebook spot-check data in terminology-facebook.md. Facebook vocabulary is primarily from Muse: [[2026-10-31-muse-facebook-marketplace]].

## Top 15 terms for search and categorisation
Each is tagged FILTER, FACET or SYNONYM. (2026-10-31, terminology.md)
1. Make (FILTER)
2. Model with rebadge platform (Carry=Scrum=NT100 2013+=Minicab DS16T; Hijet=Pixis=Sambar 2012+) (FILTER)
3. Chassis code (FILTER); 2nd digit = 4WD (HA3/HA4, S200P/S210P, TT1/TT2, U41T/U42T)
4. Model year plus build month (25-yr rule runs from build month) (FILTER)
5. Drive 2WD/4WD (FILTER)
6. Low-range system: transfer case "2H-4H-4L" vs extra-low gear "EL/Ex Low/UL" (FACET)
7. Diff lock (FILTER)
8. Body: standard / jumbo / dump (electric, PTO, scissor, HD, low) / van / deck van / fire / crane / refrigerated (FACET)
9. Transmission MT/AT/CVT (FILTER)
10. Mileage plus unit (FILTER)
11. Title status (FILTER)
12. Legal class: 25+ yr import vs new off-road (FILTER)
13. A/C (FILTER)
14. Supercharger/turbo (FILTER)
15. Trim grade: Attack, Climber, SDX, KC/KU, Jumbo/Super Jumbo, Extra (FACET)

## Corrections
- CORRECTION for [[glossary]]: "Farm Master / Field Master" is not a trim. It is absent from all 51 dealer pages; dealers say "Farming Package". (2026-10-31, terminology.md; Muse)
- CONFLICT (open): sources disagree on: (2026-10-31, terminology.md §3)
  - DA63T start year (2002 vs 2003)
  - whether KS4 means 4WD or supercharged
  - whether S83P is full-time or part-time 4WD
- "Red cap" Sambar: Japanese sources tie it to Akabō, a light-freight cooperative, not JA farmers. The JA link is unverified. (2026-10-31, terminology.md §6)

## Dealer vs Facebook wording (2026-10-31, terminology.md "Dealer vs Facebook")
- Dealers write "4WD" and spell out the low-range system. Private sellers write "4x4" and rarely mention low range or diff lock (Muse: hi/lo 8%, diff lock 2%).
- Status vocabulary (arriving, en route, reserved, sold archive) exists only on dealer sites.
- Price qualifiers:
  - dealers: deposit, + tax, regular vs sale, "Cleared Customs Price" (CAD)
  - private sellers: OBO, firm, no lowballers, placeholder prices $1 / $123,456
- New-unit tells: "Off-Road Use Only", "EPA certified", "Made by Toyota", CVT, pre-order, "Farming Package", "THOR". They never appear on 25-yr units, so they are a good legal-class classifier.
- "Mini truck" alone is ambiguous on Facebook (S-10/Ranger), but always means kei on dealer sites. Require a kei make, model or chassis signal before trusting it. (Muse; dealer captures)

## Facebook access via Browser Farm (spot-check, logged out)
- Every load, 1st to 15th across 3 sessions, showed a closable login popup over a fully loaded page (HTTP 200, no redirect). (2026-10-31, terminology-facebook.md)
- Marketplace search gives 15 cards with no pagination. Groups show 1 post. Listing pages are fully readable. The search HTML embeds clean listing JSON (`marketplace_listing_title`, mileage subtitle, struck price).
