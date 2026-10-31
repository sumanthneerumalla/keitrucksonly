# keitrucksonly.com: Facebook groups, dealer pages, Reddit (research 2026-10-31)

All counts are from logged-out page loads on **2026-10-31** unless marked otherwise. "Activity" means posts in the last month, as Facebook's About tab reports it. Raw captures are in `scratchpad/bf/out/ga_*.txt` (group About pages), `fp_*`/`fb_*` (pages) and `rd_*` (Reddit).

## Method / tooling notes
- **WebSearch was close to useless** for Facebook groups. It never returned facebook.com/groups URLs or member counts. No Reddit fetch either (WebFetch is blocked on reddit.com).
- **The Browser Farm (bf.mjs) worked well on Facebook logged out, even without residential egress:**
  - Public pages showed follower counts. The exact figure is in `<meta name=description>`, e.g. "1,425 followers · 2 talking about this".
  - **`/groups/<id>/about`** reliably returned name, public/private, member count, created date, posts today and in the last month, admin first names, "Group by <Page>" (owner page), location tags, and **the full admin rules**. This worked for private groups too.
  - Bare `/groups/<id>/` fetches hit a login wall for about half the groups after a burst of 6 parallel fetches. `/about` did not hit it, even 3 at a time.
  - Facebook's own group search (`/groups/search/...`) returns "Not Found" when logged out.
- **Discovery:** Brave Search (`search.brave.com/search?q=site:facebook.com/groups+...`) loaded through bf honours `site:` and surfaced about 70 group IDs. After about 18 queries Brave showed a bot-check CAPTCHA, so I stopped and did not try to bypass it. Bing through bf ignored `site:`, and DuckDuckGo HTML returned nothing.
- **Reddit through bf:** new-reddit pages render (old.reddit requires login, and about.json returned 404). Reddit no longer shows a subscriber count, only "weekly visitors".
- Nothing was logged into, joined or posted. The credential file was not read.

## 1. Facebook groups (US-relevant, ranked by members)

| Group | URL | Members | Type | Activity (posts/mo) | Region | Run by | Promo / seller rules |
|---|---|---|---|---|---|---|---|
| Mini Truck Marketplace | facebook.com/groups/651842066713540 | **151.3K** | Public, buy/sell | 751 (35 today) | National | Admin "Adam", mod "Emory"; no owner page shown | Generic "No promotions or spam" (self-promo/links banned). Feed looked spammy (non-truck items like shingles). |
| Japanese Mini Trucks For Sale | facebook.com/groups/991776501024817 | **75.0K** | Public | 45 | Pennsauken, NJ tag; national | Admin "Alex", mod "Tim" | No rules captured. Dealers post freely; the top post was a Durham, NC dealer (Tokyo Direct Imports) listing. |
| Kei Truck Owners | facebook.com/groups/1176504773754130 | **58.3K** | Public, discussion + buy/sell | 382 | Tags: San Francisco and Sydney (global) | Admin "John", mod "Joel"; created 2023-11-09 | **"Self Promotions require prior Admin Approval"**: DM the admin first. This is the best national target. |
| Japanese Mini Trucks of America For Sale! | facebook.com/groups/257180618510577 | **56.3K** | Private (visible) | 39 | US | **Oiwa**: description reads "Japanese Mini Trucks of America For Sale by OIWA" | Competitor-owned. Dealers get 1 truck listing a week, and **more is paid ("contact admin for pricing")**. Bans poaching and promotion other than truck listings. Avoid, or expect removal. |
| Kei Truck Club | facebook.com/groups/keitruckclub | **52.5K** | Private (visible) | 177 | National | Independent; created 2023-05-22 | **"Promotions OK, but please don't spam"**. For-sale posts need price and location. No "DM me". Accounts under 1 year old need post approval. Friendliest big group for a launch post. |
| KEI Trucks & Vans Inspiration FIND & LOCATE! | facebook.com/groups/everythingkei | **31.6K** | Public | 96 | National | Admins "Timothy" and "Johnny" (Johnny Gerace IV posts side-hustle promos himself) | No rules shown. Calls itself the "largest kei truck/van group on FB", which is false. |
| Japanese Mini Trucks of America | facebook.com/groups/1491121737584558 | **29.9K** | Private | 98 | US | Unknown. Rules read the same as the Oiwa group ("DEALERS TAKE NOTICE"), so it is **possibly** the same operator | Dealers may post if they physically hold the vehicle. Bans raffles. |
| Japanese Mini Trucks | facebook.com/groups/254657701625775 | 18.2K | Public | 9 | National | Owned by the page "Japanese Mini Trucks" (a dealer or brand page) | Mostly dormant. |
| FLORIDA KEI CLUB (JDM Culture) | facebook.com/groups/430644069272458 | 15.3K | Public | 293 | Orlando, FL | **Owned by Miyagi Garage (dealer)** | "No promotions or spam". |
| New England Mini Kei Truck / Van JDM Group | facebook.com/groups/newenglandkeitruckvan | 14.6K | Public | 88 | CT/NY/MA/RI/VT/NH/ME/NJ | **Owned by JDM Imports CT (dealer, 10.5K-follower page)** | No rules captured. Buy/sell allowed. |
| Japanese Kei Mini Trucks TX/OK/LA/NM Buy and Sell | facebook.com/groups/347033625797435 | 6.6K | Public, buy/sell | 22 | TX/NM/OK/LA | **Owned by Lonestar Mini Trucks (dealer)** | n/a |
| Kei Club Mini Trucks | facebook.com/groups/806101033392047 | 6.4K | Public | 89 | West Babylon, NY | Admin "Brandon" + 2 others | Parts and vehicles for sale allowed. No spam or bots. |
| Japanese Mini Trucks of Alabama (Sale/Trade/Barter) | facebook.com/groups/1527330174207038 | 5.8K | Public | 43 | AL | Admin "Mickey" (looks independent) | Kei trucks only. Scammers get banned. Promo not explicitly banned. |
| PNW Kei Community | facebook.com/groups/pnwkei | 4.7K | Private | 41 | WA/OR/ID/BC | **Independent** (says so); created 2018 | **"No promotions or spam"** and **"Dealers and importer vehicle sales ads are not allowed at all"**. Personal sales only, physically in the PNW, US title required. **No gen-AI content.** A launch post would need admin OK. |
| Suzuki Carry Owners – Kei Trucks | facebook.com/groups/1310495989828937 | 3.5K | Private | 58 | US | Independent | No self-promo or links. "Will not turn into a marketplace for companies." |
| Everything Florida Mini Trucks | facebook.com/groups/1974723889443541 | 2.7K | Public | 10 | FL | Admins "Zachary" and "Jason" | n/a |
| Utah kei trucks and vans | facebook.com/groups/514853969866616 | 2.6K | Private | 42 | UT | n/a | n/a |
| 530 Mini Trucks | facebook.com/groups/1069047523175438 | 1.7K | Private | 28 | NorCal (530) | n/a | Mostly classic mini-truckin' (S10 etc.) plus kei. Mini-truck-related posts only. |
| California Kei Trucks and Kei Cars (SoCal Kei Scene) | facebook.com/groups/socalkeiscene | 903 | Private | 2 | Long Beach, CA | n/a | "If you are not a group approved business affiliate, please do not post." |
| Kei In The Tampa Bay | facebook.com/groups/1139458846448149 | 830 | Private | 14 | Tampa, FL | n/a | Self-promo banned, but "sales, commercial posts allowed but limited in volume". |
| Lone Star Kei | facebook.com/groups/239937052506096 | 748 | Private | 4 | TX | Advocacy group (the TX kei-rights movement; pinned on r/keitruck) | No promotions or sales outside the strict for-sale format. **No cross-posting identical content between groups.** |
| NC KEI CLUB | facebook.com/groups/641055883736675 | 725 | Private | n/a | NC | n/a | n/a |
| Capital Kei Car Club | facebook.com/groups/capitalkeicarclub | 590 | Private | 9 | DC/MD/VA | n/a | n/a |
| MN Kei Club | facebook.com/groups/3121942587952019 | 226 | Public | 6 | MN | "Sponsored by MN's highest volume JDM/Kei importer" (dealer-run) | n/a |
| Austin Kei Car Club | facebook.com/groups/austinkeicarclub | 67 | Private | 0 | Austin, TX | n/a | Dead. |
| NorCal Kei Club | facebook.com/groups/736636772064066 | 52 | Public | 1 | NorCal | Armaan Ghovanloo | Dead. |

Non-US groups seen and excluded: Mini/Kei Trucks Canada (mini.kei.trucks.canada), Japanese Mini Trucks of Alberta, K-SQUAD (AU, 7.7K), Japanese Mini Trucks Australia & NZ, NSW Kei Club, Kei Car Club Nederland, plus UK and NZ groups.

**Not found:** Texas Kei Truck Advocates, Michigan Kei Advocates, Empire State Kei Advocates and JDM Oregon Advocates. They exist as orgs or sites (texasimportsociety.org, michigankeiadvocates.com) and appear in press. Brave's CAPTCHA stopped discovery and guessed vanity slugs returned "content isn't available". Lone Star Kei appears to be the active TX advocacy group now. NC KEI CLUB was found (725 members).

### Takeaways for launch distribution
- **Best targets:** Kei Truck Club (52.5K; promos OK, no spam), Kei Truck Owners (58.3K; ask the admin first) and Kei Club Mini Trucks (6.4K, NY). Big public buy/sell groups (Mini Truck Marketplace 151K, JMT For Sale 75K) have generic no-promo rules but are loosely moderated. A listing-style post probably works better than a site plug.
- **Competitor- or dealer-owned groups (expect deletion or bans):**
  - The Oiwa "JMT of America For Sale!" group (56K). It already charges dealers for extra listings, so a free aggregator is a direct threat to it.
  - JDM Imports CT (New England, 14.6K).
  - Miyagi Garage (Florida Kei Club, 15.3K).
  - Lonestar Mini Trucks (TX/OK/LA/NM, 6.6K).
  - The MN importer group.
- **Independent regional groups mostly ban promotions and dealer ads:** PNW, Lone Star Kei, Suzuki Carry, SoCal. Message admins first. A "free, no-dealer-fees, owner listings welcome" angle fits their anti-dealer stance. PNW also bans gen-AI content, so don't use AI images in posts there.
- **Cross-posting is risky.** Lone Star Kei explicitly bans identical content across groups. Write a unique post per group.
- **Anti-Oiwa sentiment is strong.** r/keitruck has a pinned community highlight titled "Reminder: Oiwa is an awful predatory company". Positioning as the honest, free alternative will resonate.

## 2. Dealer Facebook pages

| Dealer | FB page | Followers (exact) | Activity signal | Notes |
|---|---|---|---|---|
| JDMbuysell.com (aggregator competitor) | facebook.com/jdmbuysell | **30,748** | 35 talking about this | Burnaby BC. The largest page in the space. |
| JDM Imports CT | facebook.com/JDMimportsCT | **10,518** | 14 talking, 397 check-ins | Coventry CT. Owns the 14.6K New England group. |
| G&R Imports | facebook.com/grimports155 | **6,059** | 10 talking; latest post seen Oct 20 | Jackson MO. RV dealership category, 94% recommend (30 reviews). |
| HVNY Imports | facebook.com/HVNYImports | **1,451** | none shown | Goshen NY. **keitruckking.com links to this same FB page**, so Kei Truck King appears to be HVNY's brand (both in Goshen NY). |
| Boeki USA | facebook.com/boekiusa | **1,425** | 2 talking; last visible post 2021 | Paterson NJ. Weak FB presence. Also on YouTube (@minitruckwholesale) and TikTok. |
| Skyline JDM (Skyline Kei Trucks) | facebook.com/jdm.motors.skyline | **262** | **138 talking about this** (high for its size, so it posts a lot) | Houston TX. |
| Oiwa Garage | facebook.com/OIWA.co (linked from oiwagarage.co and keitruckus.com) | n/a | "Content isn't available" logged out (restricted, or age/region-gated) | Its FB reach comes through the 56K group instead. keitruckus.com also links a "Kei Truck US" news page (facebook.com/1428190533705007) with 0 followers. |
| Northwest Mini Trucks | facebook.com/nwminitrucks (guessed slug) | 0 shown | none | A page exists ("one of the largest JDM dealers in the PNW") but it is dormant or stale. Its site has no FB link. |
| Mayberry Mini Trucks | none found | — | — | Its site links only to YouTube. It gets organic praise in Kei Truck Owners (thread "Kei truck owners recommend Mayberry Mini Trucks"). |
| JPM Mini Trucks | none found | — | — | Site (321 area code, FL) runs the FB SDK but has no page link. Sells via its own site and "BidDrive" auctions. |
| Tiki Bunny Imports | none found | — | — | Wix site, (413) MA. No FB link found. |
| Lancaster Mini Truck | not found | — | — | No website and no search hits. The guessed FB slug returned "not available". It probably lists only on Marketplace or under a personal profile. **This needs a logged-in FB search by the owner.** |
| Kei Truck King | → HVNY Imports page | — | — | See HVNY. |

Other dealer-run pages and groups seen: **Miyagi Garage** (Orlando, owns the FL Kei Club), **Lonestar Mini Trucks** (TX), **Tokyo Direct Imports** (Durham NC, posts in the 75K group), minitrucksnorthwest.com → facebook.com/offroadminitrucks (not available logged out), and **Kei Truck MeetUp** (facebook.com/keitruckmeetup, a profile and not a page).

**FB-first or Marketplace-first sellers:** most small dealers list into the big buy/sell groups (JMT For Sale 75K, Mini Truck Marketplace 151K) rather than building page followings. Page followings are small apart from JDMbuysell and JDM Imports CT. Lancaster and similar no-website sellers are only reachable on FB, and that would need a logged-in Marketplace or search pass.

## 3. Reddit r/keitruck
- **reddit.com/r/keitruck**: public, created 2020-05-25.
  - **36,797 weekly visitors**, 695 weekly contributions (2026-10-31). Reddit no longer shows a subscriber count.
  - A CNN story (July 2024) said "over 23,000 members", which is the last known subscriber figure. Today's is probably higher.
- **Rules:**
  - **#3 No self-promotion "outside of registered and approved vendors"**: register as an importer, dealer, vendor or maker, get vetted, and receive a flair.
  - **#4 No buy/sell posts outside the Saturday Swap Meet thread** (member to member only).
  - #5 No raffles.
  - #7 New or low-karma accounts are auto-blocked from posting; be active for about a week first.
  - **Vending rules:** a vetted flair is required; "it's okay to hype your widget but save cost/price for DMs"; no trash-talking competitors.
- **Pinned highlights:** "Swap Meet Saturday", "Reminder: Oiwa is an awful predatory company", "Lone Star Kei – leading the fight…", and an "import your own kei" guide.
- **Implication:** the launch account should be aged and active, then apply for vendor registration and flair before posting about keitrucksonly.com. A free, non-dealer aggregator fits the "friend of the community" framing the mods ask for.
- r/KeiTruckBuilds had about 2K members (old GummySearch figure, unverified).
