---
title: State registration laws
type: topic
tags: [law]
updated: 2026-10-31
last_verified: 2026-10-31
sources: [designFiles/keitrucksonly-strategy.md, designFiles/keitrucksonly-research-2026-10-31/gap-states.md]
---
**Summary:** What we know so far about where kei trucks can be road-registered. Not yet a verified 50-state table; sources disagree (7 to 22 "fully legal" states).

## Direction
- Trending toward allowing: TX SB 1816 (2025), CO HB25-1281 (effective **2027-07-01**, requires 25+ years), VT Act 153 (2026), reversals in MA and MI. (2026-10-31, strategy)
- Restricting: RI, NY, IL, WI, ME, GA. (2026-10-31, strategy)

## By state
- state/GA: refuses to title kei trucks; HB 957 died in 2026. Dealers sell off-road only. (2026-10-31, gap-states.md)
- state/OR: refuses to register; HB 4063 died in 2026. (2026-10-31, gap-states.md)
- state/ME: working group recommended no change; also a 2025 online-dealer law needing a license + $350k bond (relevant if we ever took commissions). (2026-10-31, gap-states.md + strategy)
- state/CO: road registration from 2027-07-01 for 25+ year trucks; new-import dealers there won't qualify. (2026-10-31, gap-states.md)
- state/TN, state/OH: registration allowed; few dedicated lots. OH dealer supplies the Ohio inspection document. (2026-10-31, gap-states.md)

## Product implications
- Each listing needs a street-legal (25+ yr import) vs off-road-new flag. See [[data-model]].
- `StateRule` rows carry a citation URL and a `lastVerified` date; owner personally verifies TX, CO, FL, NC, TN, WA, OR, CA, PA, MI, GA, NY, OH, VA, AZ. (2026-10-31, playbook)
- Tariffs: 25% chicken tax applies; 25+ year vehicles exempt from the 2025 Section 232 auto tariff. (2026-10-31, strategy)
