# KeiTrucksOnly go-to-market playbook (free marketplace + content + mailing list)

Starts Mon 2026-11-02. The first decision point is Mon 2027-02-01. Background research is in `keitrucksonly-strategy.md`.

## Positioning (one line)
**"Every kei truck for sale in the US, filtered to the ones you can actually register in your state."**
- Listings are free. Dealers get clicks straight to their own site.
- Buyers get state-registration filters, saved-search alerts and a monthly price index.

---

## Week 0 (Nov 2–8): set up
| # | Task | Owner | Done when |
|---|---|---|---|
| 1 | Register **ktrucksonly.com** and redirect it to keitrucksonly.com | You | Redirect works |
| 2 | Put a "coming soon" page on keitrucksonly.com: **"Get an email when kei trucks you can register in your state are listed."** Fields: email, state, model of interest (optional). | You + Claude Code | Signups saving |
| 3 | Set up an email tool. Kit is free up to 10k subscribers; or use the repo's `EmailGroup` with Resend/Postmark. | You | Test email delivered |
| 4 | Create a Facebook page, an Instagram account and a Reddit account under the brand. Use your **real name** on Reddit. | You | Handles secured |
| 5 | Build the **dealer prospect list**: 40–60 US/Canada kei dealers with name, site, state, inventory page URL, contact, whether they have a feed or CSV, and approximate listing count. Sources: KeiTruckUS's 18 dealers, JDMBuySell dealer pages, Google "kei truck dealer [state]". | Agent | Spreadsheet in repo or Drive |

**Starting dealer names** (from research): Boeki USA, Kei Truck Direct, Mini Monsters (UT), JPM Mini Trucks, Kei Trucks America, minitrucks.net, Rocky Mountain Mini Trucks, G&R Imports (MO), Kei Truck King, Mars Mini Trucks (NC), Krazy Kei Imports, Tiki Bunny, Granite State Imports (NH), Mayberry, Mini Truck Depot, JDM Connection (AB), buykeitrucks.ca.

---

## Weeks 1–4 (Nov 9 – Dec 6): build the MVP and sign up dealers at the same time

### Build (Claude Code, reusing the existing codebase)
- `Dealer`: reuse `Club` and its public page as a free dealer storefront.
- `Listing`:
  - model, chassis code, year, frame number (optional for dealers), price, mileage (km/mi), 4WD, dump bed, A/C
  - photos (reuse `Media`), location state
  - `sourceUrl` linking back to the dealer
  - `status`, `lastSeenAt`
- `StateRule`: state, road-registration status, minimum age, any restrictions, `citationUrl`, `lastVerified`.
- **Registerable filter**: work out which states each listing can be registered in from its year and the `StateRule` table. Show "✔ Can be registered in TX" on the listing.
- **Inventory import**: CSV upload, plus a per-dealer page scraper (with written permission) run nightly. Mark listings sold or removed when they disappear from the dealer's site.
- **Saved searches** with email alerts (reuse `EmailGroup` / `EmailSendLog`).
- **Article pages**: reuse `Article`.
- **Outbound click tracking** for each listing and dealer. This is the number you will report back to dealers.
- Hide private-seller listings behind a flag until week 9.

### Dealer outreach (you send; an agent drafts and follows up)
- **Week 1:** email the 40–60 prospects.
- **Week 2:** follow up by email, and phone the top 15 by listing count.
- **Target:** 15 dealers say yes, which is ≥ 300 listings.

**Dealer email template**
> Subject: Free listing for your kei trucks + buyers filtered by state
>
> Hi {name}, I'm building KeiTrucksOnly.com, a free kei truck search that shows buyers only the trucks they can register in their state. That means fewer tire-kickers from states where they can't.
>
> I'd like to list your inventory for free. Every click goes straight to your own listing page, and there's no fee or commission. I'll pull it from your site nightly (or a CSV if you prefer) and send you a monthly report of how many buyers you got from us.
>
> OK to add {dealer}? If you say yes, I'll have it live this week.
> {your name}, {phone}

### Legality data (an agent researches, you verify)
- Draft all 50 states and the main provinces, each with its citation.
- **You personally check the 15 states with the most volume:** TX, CO, FL, NC, TN, WA, OR, CA, PA, MI, GA, NY, OH, VA, AZ.
- Every state page shows "last verified on {date}" and links to its source.

---

## Weeks 5–6 (Dec 7–20): soft launch, once there are 300 or more listings
1. **Message the r/keitruck moderators before posting anything:**
   > Hi mods, I've built a free kei listings search that filters by state registration, with a 50-state law table that links to the actual statutes. I'd like to share a monthly price report from the listing data (no ads, no paywall). Is that OK, and is there a format you'd prefer? Happy to give the mod team the law table to use as a resource.
2. Email Texas Kei Truck Advocates, Michigan Kei Advocates and Empire State Kei Advocates. Offer the state law table and a free embed.
3. Launch post on your own Facebook page. Share it into regional groups (PNW Kei, NC KEI CLUB) that **aren't** run by competitors, after reading each group's rules.
4. **Publish the first K Truck Price Index (December 2026):**
   - median asking price by model
   - 4WD and dump-bed premium
   - price ranges by state
   - number of listings
   - chart plus a short write-up

---

## Weeks 7–12 (Dec 21 – Jan 31): the weekly routine

| Cadence | What | Owner |
|---|---|---|
| Daily | Inventory sync; flag dead or duplicate listings | Agent |
| Daily | Check for law changes (bills, DMV notices, news) and draft updates | Agent → you approve |
| Weekly (Thu) | Email: new listings in your state, law changes, one reader story or Q&A | Agent drafts → you edit and send |
| Weekly | One original article, e.g. "What it took to register a '97 Carry in Georgia", "4WD vs 2WD prices", "How to read a frame number" | You plus an agent draft |
| Weekly (Mon) | KPI scorecard (see below) | Agent |
| Monthly (1st) | Price Index published to the site, the email and Reddit (with mod approval) | Agent drafts → you post |
| Monthly (1st) | Report to each dealer: clicks, saved-search matches, and the question "did any of these turn into a sale?" | Agent sends after your approval |
| **Week 9** | Open **private-seller listings**. Required: frame number, photo of the frame rails, title or import paperwork status. Never handle deposits. Show a scam warning on any listing where a Japanese exporter asks for a deposit. | Claude Code |

**What you do yourself, not an agent:** Reddit and Facebook comments, the first email to every dealer, sign-off on law content.

**About 15–20 hours a week.**

---

## Decision point: Mon 2027-02-01

| Metric | Continue | Rethink |
|---|---|---|
| Live listings | ≥ 300 from ≥ 15 dealers | < 100 |
| Monthly visitors | ≥ 2,000 (winter; searches peak in Sept and are 30–40% lower off-season) | < 400 |
| Clicks out to dealers per month | ≥ 150 | < 30 |
| Email subscribers | ≥ 500 | < 150 |
| Dealers confirming at least one sale came from us | ≥ 3 | 0 |

**If it clears "continue":**
- **Feb–Mar 2027:** add paid **featured listings** for dealers (about $29–99) and a "Verified" badge.
- **Apr–Jun 2027:** Colorado push ahead of its 2027-07-01 legalization: Colorado law page, Colorado dealers, Colorado saved-search campaign, local press.
- **Jul–Sep 2027:** peak season. Run a small ads test ($300–500) promoting the *registerable search*, not individual vehicles.

**If it lands in "rethink":** check which number failed.
- Listings low: supply problem. Change the dealer offer.
- Visitors low: distribution problem.
- Clicks low: the product isn't useful. Fix that one before changing anything else.

---

## Budget for the first 90 days
| Item | Cost |
|---|---|
| ktrucksonly.com | ~$10 |
| Email tool | $0 (Kit free tier, or Resend's free tier) |
| Hosting | Existing infrastructure |
| Ads | $0 until February |
| **Total** | **< $50 + your time** |

## Agents for this phase (just three)
1. **Inventory Sync:** nightly import, sold and stale detection, duplicate removal.
2. **Law Watch:** monitors bills, DMV pages and news, and opens a PR updating `StateRule` with the citation.
3. **Digest + KPI:** drafts the weekly email, the monthly price index and dealer reports, and writes the Monday scorecard.

Outreach, ads and feature-evaluation agents come after Feb 1, once there's data to work from.
