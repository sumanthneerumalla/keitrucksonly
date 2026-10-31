---
title: Glossary
type: topic
tags: [research]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-strategy.md, designFiles/keitrucksonly-research-2026-10-31/dealers.md, designFiles/keitrucksonly-research-2026-10-31/gap-states.md, designFiles/keitrucksonly-gtm-playbook.md]
---
**Summary:** Terms used across the wiki. Only what the sources support; add more via the inbox.

- **Kei truck:** Japanese mini truck in the kei class. Models seen in sources: Suzuki Carry, Daihatsu Hijet, Honda Acty, Subaru Sambar, Mitsubishi Minicab. Also called "mini truck" in search; "kei" leads in the West and New England. See [[search-demand]]. (2026-10-31)
- **25-year rule:** Vehicles 25+ years old can be imported; they are also exempt from the 2025 Section 232 auto tariff. Street legality is still decided per state. See [[state-laws]]. (2026-10-31, strategy)
- **Chicken tax:** the 25% tariff that applies to these imports. (2026-10-31, strategy)
- **Chassis codes (top six for the decoder):** DA63T and DA16T (Suzuki Carry); HA3/HA4 and HA6/HA7 (Honda Acty); S200P and S500P (Daihatsu Hijet). The Sambar TT family follows. Examples of frame numbers: DA63T-xxxxxx, HA4-xxxxxxx, S210P-xxxxxx. (2026-10-31, strategy)
- **Frame number / chassis number / VIN:** the Japanese chassis ID (e.g. `U42T-0425553`); dealers expose it as `vin`, `chassis_number` or JSON-LD `vehicleIdentificationNumber`. Playbook: optional for dealers, required for private sellers. (2026-10-31, dealers.md, playbook)
- **Street-legal import vs off-road-new:** street-legal imports are 25+ year old used trucks; off-road-new are new Hijets/Carrys sold for off-road use only (Weatherford lane `off_road_new` vs `street_legal_25_plus`). `Listing` needs this flag. See [[weatherford-mini-trucks]]. (2026-10-31, dealers.md)
- **Gap states:** GA, ME, OR refuse road registration; listings there carry "off-road only in this state". CO road registration opens later (see [[state-laws]]). (2026-10-31, gap-states.md)
- **RHD:** right-hand drive (the usual kei import). (2026-10-31, dealer-prospects.csv)
- **Registerable filter:** the core feature: listing year + `StateRule` -> "can be registered in <state>". See [[positioning]]. (2026-10-31)
- **RORO:** roll-on/roll-off shipping, e.g. Autocom Japan to Jacksonville for Mayberry. (2026-10-31, dealer-sales-evidence.md)
- **Oiwa Garage / KeiTruckUS.com:** parts retailer and aggregator competitor. See [[competitors]]. (2026-10-31)
