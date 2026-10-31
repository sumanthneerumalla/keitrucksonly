# KeiTrucksOnly: niche, go-to-market and solo operating strategy

Written 2026-10-31. Based on four parallel research passes (marketplaces, parts/support, community, regulation and competition).

**About the data:**
- Reddit, Facebook, TikTok and Google Trends blocked direct fetches.
- Reddit numbers come from GummySearch snapshots, which are undated and the service has since shut down.
- Search-volume figures are vendor estimates.
- Treat every number below as directional. Check it before betting money on it.

---

## 1. Landscape in one page

| Area | Who holds it today | Evidence | Open gap |
|---|---|---|---|
| **Listings / for-sale search** | **JDMBuySell**: about 1,000 kei listings, free dealer accounts with feed import, revenue from paid boosts ($49 for 3 days / $149 for 7 / $299 for 14), heavy programmatic SEO. Facebook Marketplace for private sales. **KeiTruckUS**, run by Oiwa, aggregates 18 dealers and 402 listings. | jdmbuysell.com/about/boost-your-ad, keitruckus.com | No **trust layer**. Every listing is unverified. Buyers fear rust under fresh paint, odometer km/mi conversions, fake Japanese exporters and title problems. |
| **Dealers** | Dozens of small importers. Typical volume is about 40–60 trucks a year each (Krazy Kei, Tiki Bunny, Mars Mini Trucks). Since 2023 Facebook has not let business pages post free vehicle listings. | spectrumnews1, jalopnik | Dealers are too small to pay much, but they badly need qualified leads in **legal** states. |
| **Parts** | **Oiwa Garage** (content leader, expanding into CA, AU and EU), Mini Truck Garage, G&R Imports, KEI Import Parts, Rocky Mountain Mini Trucks, eBay stores, and Japan-direct sellers (Amayama, Megazip, Yahoo Auctions proxies). | oiwagarage.co, amayama.com | No free **English decoder that turns any brand's frame number into a model/date/options**. No cross-reference from **OEM part numbers to parts sold in US stores (NAPA, Denso)**. Owners keep personal spreadsheets, and Facebook groups keep interchange lists. |
| **Repair / support** | Importer-dealers that also do service. One dedicated kei shop found, in Honolulu. | grimports, keitruckking | **No kei mobile mechanic, remote diagnosis, subscription or third-party warranty exists anywhere.** Owners post on city subreddits offering to pay someone to teach them. |
| **Discussion** | r/keitruck has about 66k members (+45% in a year; about 23k in mid-2024). r/KeiTruckBuilds has about 10k (+430%). Oiwa claims Facebook groups totalling about 200k. MiniTruckTalk is fading. | gummysearch, theweeklydriver | No dedicated forum ranks in Google, and keitruckforum.com is unregistered. Reddit is the de facto forum and would be hard to displace. |
| **Legality info** | Oiwa's "50-state guide" (Oct 2026), JDMBuySell guides, and a crowdsourced Reddit thread. | | **Sources disagree**: counts of fully legal states range from 7 to 22. Searches for "kei truck legal in [state]" are up about 85%. No source is versioned, cited to the actual statute, and paired with change alerts. |
| **Insurance** | Patchy. Hagerty covers limited model years, GEICO declines, Progressive and State Farm are inconsistent, and short Japanese VINs break underwriting systems. | r/keitruck mirrors | "Mini truck insurance" searches are up about 55%. Nobody is routing these buyers to a carrier. |
| **Content** | Big general creators drive the spikes: PrestonGoes' railroad truck has 4.6M views, Mike Festiva's videos get about 1M each, WhistlinDiesel's jet Acty went viral. Channels dedicated to kei trucks stay tiny. | vidiq | Build, adventure and absurd content wins. Dealer walkarounds don't. |

**Market size:**
- About 1,800 trucks were imported in 2018 and about 7,500 in 2023.
- More than 30,000 have been imported since 2020.
- The US installed base is therefore in the tens of thousands, not millions.
- Typical landed cost is $5.3–7.8k. The median road-legal retail price is about $8.8k.

**Regulatory direction:** mixed but trending toward allowing them.
- Toward allowing: Texas SB 1816 (2025), Colorado HB25-1281 (effective **2027-07-01**), Vermont Act 153 (2026), and reversals in Massachusetts and Michigan.
- Restricting: RI, NY, IL, WI, ME and GA.
- Tariffs: the 25% "chicken tax" applies. Vehicles 25+ years old are exempt from the 2025 Section 232 auto tariff. Parts pay 15% under the US–Japan deal.

---

## 2. Pre-mortem: "a hub to buy, sell and discuss everything kei" (assume it is dead by Nov 2027)

### Crack 1, the worst: an undifferentiated hub, crushed on all four fronts at once
- **Listings:** JDMBuySell already offers free listings with feed import and dominates for-sale search. A new classifieds site starts with zero inventory, so it gets zero buyers, so dealers never bother uploading.
- **Discussion:** r/keitruck is free, has 66k members and is growing 45% a year. Nobody moves to a stranger's forum.
- **Parts:** Oiwa owns parts search **and** about 200k Facebook members **and** a dealer aggregator **and** a 50-state guide. It is building the same "hub", funded by parts margin.
- **Result:** the site ends up a fourth-best version of four things, and its traffic stays near zero.

### Crack 2: a small market that one state's DMV can shrink
- About 7.5k imports a year, and the dealers sell about 50 trucks a year each, so subscription or listing revenue caps out low.
- One DMV memo (RI, IL and WI all did it) can wipe out a state's demand overnight.
- A listing that says "street legal" without naming the state can expose the site to liability.
- Taking a commission on vehicle sales can make you a dealer under some state laws. Maine's 2025 online-dealer law requires a license and a $350k bond.

### Crack 3, the mildest: agent-run growth turns into low-trust AI slop
- Kei search results are already flooded with machine-written `*.pages.dev` sites.
- Reddit and Facebook groups ban accounts that self-promote.
- In a market where buyers' biggest fear is being scammed, an agent posting outreach under your brand burns the one asset you can't buy back, which is trust.
- Google's helpful-content updates bury thin programmatic pages.

---

## 3. The niche: be the vendor-neutral **trust and know-how layer**, not another listings site

**Thesis:**
- Every incumbent is either a seller (Oiwa sells parts, dealers sell trucks) or a listings aggregator with no verification (JDMBuySell).
- Nobody neutral answers the three questions owners ask most:
  1. Is this truck what the seller says it is?
  2. Can I legally register it where I live?
  3. Who can fix it, and which part fits?
- The ShuttleMentor codebase is already a **video review marketplace**: a coach annotates a student's uploaded video with timestamped notes. The same mechanics work for a mechanic annotating an owner's or buyer's video.

### Wedge, ranked by how well the demand is validated and how strong your edge is

1. **Decoder plus fitment ("What truck is this? What part fits?"): free, the top of the funnel.**
   - Paste a frame number (DA63T-xxxxxx, HA4-xxxxxxx, S210P-xxxxxx) and get the chassis code, model, engine, estimated production date, a service-interval sheet, known issues and part numbers for common wear items, plus where to buy each part from **several** vendors.
   - **Proof of demand:** "what model is this" and "where do I buy parts" are the top recurring questions. Amayama and Megazip show that people already use frame-number lookups. Owners build spreadsheets by hand.
   - **Revenue:** affiliate links (eBay Partner Network, Amazon, and direct referral deals with Oiwa's competitors) and email capture.
   - **Moat:** your data, verified by users ("this NAPA filter fits my HA4"). AI text can't copy that.

2. **A legality tracker that cites its sources, versions its changes and sends alerts: free, the top of the funnel and your PR engine.**
   - Each state gets a status, the statute or DMV citation, a "last verified" date and a change log.
   - Owners can file **registration reports** ("registered a '98 Carry in Travis County on 2026-10-12, here's what the clerk asked for").
   - Owners can subscribe to email alerts for their state.
   - **Proof of demand:** this is the top complaint, searches are up 85%, and sources contradict each other.
   - **Edge:** neutrality and citations. Oiwa's guide is a funnel to its parts store.

3. **Remote video diagnosis and pre-purchase review by kei mechanics: paid, the first revenue.**
   - **Owners** upload a video of the noise, leak or no-start and get timestamped notes from a kei-literate mechanic. $39–79 per review.
   - **Buyers** send the seller a guided photo and video checklist: frame rails, the rust spots where water collects, odometer, export certificate and CBP 7501, title. A mechanic plus a document review returns a pass/flag report. $79–149.
   - **Proof of demand:** zero competitors were found, owners say they would pay, and the pre-purchase inspection business already exists for regular cars (Lemon Squad and others).
   - **Reuse:** `CoachProfile` becomes `MechanicProfile`, `Media` plus `MediaCoachNote` become the diagnosis video and notes, and the existing booking, invoice and Stripe Connect code handles payouts.

4. **A "verified" listings overlay: the marketplace you wanted, entered from a position of strength.**
   - Don't build open classifieds first. Accept **only trucks that pass verification** (that's what the "Only" in KeiTrucksOnly stands for).
   - Dealers pay $49–149 a month for a verified storefront, leads filtered by state legality, and a badge they can display on JDMBuySell and Facebook too.
   - Earn per listing or per subscription, **never** a commission on the vehicle sale. That keeps you out of dealer licensing.

5. **Insurance and financing referral: secondary revenue.**
   - Route buyers to carriers that will insure a kei truck, sorted by state.
   - Use flat referral or lead fees only. Check each state's producer-licensing rules before taking per-policy pay.

### Who to target first
- **Primary: hobbyist owners and builders who are online.** r/KeiTruckBuilds grew 430%. They are the easiest to reach, they need parts and diagnosis, and they generate content.
- **Secondary: first-time buyers in newly legal states.**
  - Texas is legal now.
  - **Colorado takes effect 2027-07-01.** Plan a Colorado launch for April–June 2027, with a Colorado legality page, Colorado dealers, Colorado registration reports and Colorado press.
  - Vermont is legal from 2026.
  - Search interest peaks in September.
- **Later: farms, landscapers and small businesses.** They pay more but are reached through offline channels. Go after them with dealers and insurance partners.

---

## 4. Go-to-market: the first 120 days

### Phase 0, weeks 0–3: build only what proves demand
- Rename the repo, set up keitrucksonly.com, and register **ktrucksonly.com** as a redirect (it is unregistered; a quick test is at the end of this doc).
- Ship the **legality tracker**, with all 50 states, Canadian provinces, citations and email alerts.
- Ship a **decoder v0** covering the top six chassis codes:
  - DA63T and DA16T (Carry)
  - HA3/4 and HA6/7 (Acty)
  - S200P and S500P (Hijet)
  - The Sambar TT family follows.
- Add a **"Get a kei mechanic to review your video – $49"** button that takes a Stripe pre-order or waitlist sign-up. This is a smoke test for willingness to pay.

### Phase 1, weeks 3–8: plug into the networks that already exist
- **Advocacy groups:** Texas Kei Truck Advocates, Michigan Kei Advocates, Empire State Kei Advocates, and the RI and GA groups. Give them the tracker as an embeddable widget (the existing `(embed)` route group already does this) plus bill alerts. They need a rallying tool and you need distribution.
- **Reddit:** you, not an agent, answer questions in r/keitruck and r/KeiTruckBuilds and link to the decoder only when it answers the question. Then ask the moderators, who are recruiting, if they would pin the legality tracker as a community resource.
- **Mechanic supply:** recruit 3–5 kei-literate mechanics from importer-dealers that do service (G&R Imports, Rocky Mountain Mini Trucks, Kei Truck King and others). Pay about 60–70% of each review fee.
- **Dealers:** offer 10–20 dealers a free "verified dealer" page and leads routed by state legality, in exchange for linking your pre-purchase checklist.

### Phase 2, weeks 8–16: content flywheel and creators
- **Programmatic pages built only on your real data:**
  - `/chassis/[code]`
  - `/chassis/[code]/parts/[part]`
  - `/legal/[state]`
  - `/legal/[state]/registration-reports`
- **Creators:** sponsor or partner with **mid-size** builders (100k–400k subscribers, such as Mike Festiva) rather than chasing PrestonGoes-scale channels. Offer free diagnosis or verification, plus an affiliate code.
- **Events:** QR-code stickers and "decode your truck" tables at Tiny Truck Day (RI), the PNW meet (Tacoma), the SoCal Kei & JDM meet and the Lone Star Kei Rally.

### Day-120 scorecard (kill or continue)

| Metric | Continue if ≥ | Kill or pivot if < |
|---|---|---|
| Monthly decoder plus legality users | 3,000 | 500 |
| Email subscribers | 750 | 150 |
| Paid reviews or verifications | 40 total, at least 15 in the latest month | 10 total |
| Active mechanics | 4 | 1 (you can't get supply) |
| Dealers on verified pages | 10 | 3 |
| Repeat or second purchase rate | 15% | — |

### Honest revenue ceiling for year 1, solo
| Source | Estimate |
|---|---|
| Video reviews and verifications: 100–250 a month × ~$70 average × ~35% kept | ~$2.5–6k/mo |
| Dealer storefronts: 20–40 × $79 | ~$1.5–3k/mo |
| Parts affiliate and insurance leads | ~$0.5–2k/mo |
| **Realistic total at month 12** | **$5–10k MRR** |

That is a solid lifestyle business, not a venture-scale one, **unless** federal kei rules (the Dec 2025 "tiny cars" push) or a wave of states legalizing grows the market. The trust-layer position is the one that benefits most if that happens.

### Requirements to succeed (all must be true)
1. **Proprietary data, not AI-written prose.** Fitment confirmations, registration reports, verification records.
2. **Mechanic supply locked in before you spend on demand.** No mechanics means no paid product.
3. **At least one distribution partner.** An advocacy group, the r/keitruck moderators, or a mid-size creator.
4. **Legal hygiene.** No commission on vehicle sales. Every "street legal" claim names a state and links its citation. Disclaimers on everything. Check insurance-referral rules per state.
5. **A trustworthy public voice for you.** Agents draft. You post in community spaces.

---

## 5. Running it solo with agents

**Principle:** agents do the work behind the scenes (research, drafting, data, analysis, code PRs). You own anything public-facing that builds trust, anything involving money, and legal claims. Every change an agent makes goes through a PR or a draft queue. Hard caps on spending and sending are set inside each platform, not left to the agent.

| Agent | Cadence | Inputs and tools | Output | Human gate |
|---|---|---|---|---|
| **Legality Watch** | Daily | LegiScan API, state DMV pages, Autopian/Drive/Jalopnik RSS, advocacy group pages | A PR updating `StateLegality` with the citation and a diff, plus drafted alert emails | You approve the PR, and the alert sends on merge |
| **Community Listener** | Daily | Apify scrapers for r/keitruck, r/KeiTruckBuilds, MiniTruckTalk and YouTube comments | Digest of questions grouped by theme, questions nobody has answered (for **you** to answer), and content backlog items | Read-only. **Never posts.** |
| **Data / Fitment** | Continuous | User submissions, public catalogs (respecting each site's terms), interchange threads | Moderation queue entries and PRs adding fitment rows with sources | You or a mechanic spot-check a sample |
| **Content / SEO** | Weekly | Verified data, answered questions, Search Console | PRs adding pages, each citing its sources; a ranking report | You review the PR |
| **Outreach** | Weekly | Prospect lists (dealers, mechanics, creators, advocacy groups), Gmail drafts | Personalized drafts and follow-up sequences | You send first contacts. The agent may send follow-ups, capped per day, CAN-SPAM compliant |
| **Ads** | Weekly | Reddit Ads, Meta, YouTube with small budgets that **promote the tools, not vehicles** (vehicle ads are restricted) | Proposed experiments and results | Budget cap set on the platform; you approve new campaigns |
| **Trust / Verification triage** | Per order | Submitted photos, docs and frame number | Pre-screen: frame number vs. photos, document checklist, scam signals (price far below market, exporter asking for a deposit) | A mechanic signs every report |
| **KPI Analyst** | Weekly | Stripe, product analytics, Search Console, email stats, Postgres | Scorecard against the day-120 table, anomalies, kill-criteria warnings | You read it every Monday |
| **Feature Evaluator** | Bi-weekly | Feedback, funnel data, support tickets, KPI report | A ranked backlog with expected impact and a spec; Claude Code opens a PR | You prioritize and merge |

**Founder-only work:** mechanic and dealer relationships, your community voice, final sign-off on legal content, refunds and disputes, partnership deals.

**How to run it:**
- Claude Code scheduled tasks (cron) for the daily and weekly agents, with each agent's instructions kept in a skill file in `.claude/`.
- GitHub Actions for CI.
- `AuditLog` for everything an agent touches.
- The existing `designFiles/agent-workflow.md` can serve as the template for the runbook.

---

## 6. How the existing code maps over

| ShuttleMentor | KeiTrucksOnly |
|---|---|
| `Club`, club landing pages, `ClubStripeAccount` | `Dealer` / `Shop` storefronts with Stripe Connect payouts |
| `CoachProfile` and booking | `MechanicProfile`: review queue, payouts |
| `Media`, `VideoCollection`, `MediaCoachNote` | Diagnosis and verification videos with timestamped mechanic notes |
| `Article`, `ArticleTag`, sitemap, SEO helpers | Guides, chassis pages, legality pages |
| `Product`, `Invoice`, `CheckoutSession` | Review and verification orders, storefront subscriptions |
| `MembershipPlan` | Dealer plans, and later owner plans |
| `EmailGroup`, `EmailSendLog` | State legality alerts, newsletter, saved searches |
| `CalendarEvent`, `(embed)` routes | Meetups, plus the embeddable legality widget for advocacy sites |
| `AuditLog` | Audit trail of agent actions |

**New models:**
- `ChassisCode`
- `Truck` (frameNumber, chassisCode, estimated production date, options)
- `Part`, `Fitment` (with confirmation counts)
- `StateLegality` (status, citation URL, last verified, change log)
- `RegistrationReport`
- `Listing`
- `Verification`

---

## 7. Cheap tests to run before building much
1. **Willingness to pay:** a $49 video-review pre-order button on the tracker and decoder pages. Target 15 pre-orders out of the first 1,000 visitors.
2. **Mechanic supply:** cold-email 15 importer-dealers that do service. Target 3 who say yes to paid reviews.
3. **Partner pull:** offer the legality widget to 5 advocacy groups. Target 2 that embed or share it.
4. **Domain spelling:** run Reddit Ads impressions on "K truck" vs. "kei truck" creative. Organic search mostly uses "kei truck" and "mini truck". Note that r/Minitrucks is a **lowrider** community, so exclude it from targeting.
