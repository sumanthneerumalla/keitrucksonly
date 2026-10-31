---
title: v0 data model
type: topic
tags: [decision]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-handoff.md, designFiles/keitrucksonly-gtm-playbook.md, designFiles/keitrucksonly-research-2026-10-31/]
---
**Summary:** Planned Prisma models for v0 (not built). Reuse ShuttleMentor models where possible.

## Models
- `Dealer`: reuse `Club` and its public page as a free storefront. Needs **multiple locations** (e.g. [[jdm-car-and-motorcycle]] has WA and TN lots). (2026-10-31)
- `Listing`: model, chassis code, year, frame number (optional), price, mileage (km/mi), 4WD, dump bed, A/C, photos (reuse `Media`), location state, `sourceUrl`, `status`, `lastSeenAt`. (2026-10-31, playbook)
- `Listing` also needs a **street-legal (25+ yr import) vs off-road-new** flag: Weatherford, Mile High and Mini Trucks Ohio mostly sell new off-road-only Hijets. (2026-10-31, research)
- `StateRule`: state, road-registration status, minimum age, restrictions, `citationUrl`, `lastVerified`. See [[state-laws]].
- `SavedSearch`: email only, no account (reuse `EmailGroup` / `EmailSendLog`).
- Outbound click tracking per listing and dealer (the number reported to dealers). (2026-10-31, playbook)

## Registration filter
- From listing year + `StateRule`: show "✔ Can be registered in TX" per listing. In GA/OR/ME show "off-road only here". (2026-10-31)
