# Facebook / private-seller vocabulary for kei truck listings (2026-10-31)

> Raw-source copy (2026-10-31, agent:listing-sampler). Relative paths such as `raw/`, `work/`, `samples.jsonl` and `tools/` refer to the scratchpad capture dir `/private/tmp/claude-501/-Users-sumanth-Desktop-shuttlementorWorkspace/97f6b0eb-7d40-40c0-bc46-9a51ccf5690a/scratchpad/listings/` (not in the repo).

Fragment to merge into `terminology.md`. Seller names, profile URLs, phone numbers and faces were not copied. Listing text is paraphrased; only short title strings are quoted.

## Corpus

| Corpus | What | N | Raw files |
|---|---|---|---|
| **FB-T**: Facebook Marketplace search cards | Logged-out `/marketplace/<city>/search` pages: nyc (`kei truck`), dallas (`kei truck`), seattle (`mini truck`), atlanta (`kei truck`). Each gives 15 cards (title, price, struck-through old price, city) plus a mileage subtitle in the embedded JSON. | **58** titles (11 not kei: Dodge D50, Mazda B-series, Chevy S-10, Mighty Max, Humvee, an RC toy, a Honda Z kei *car*, Wuling, Cushman) | `fb/run1/mp_*.{txt,html}`, `fb/run2/mp_atlanta.*`, `fb/corpus_fb_titles.txt` |
| **FB-D**: Facebook full listing text | 8 Marketplace item pages (7 private sellers, 1 small dealer posting a "$123,456" stock list) and 1 dealer post at the top of the "Japanese Mini Trucks For Sale" group | **9** descriptions | `fb/run2/it_*`, `fb/run3/it_*`, `fb/run1/g_jmtfs.txt`, `fb/corpus_fb_desc.txt` |
| **CL**: Craigslist comparison set | Logged-out search results from dallas (4 results), atlanta (1 nearby result) and seattle (48 results; about 30 are BC/WA dealers) | **52** title lines, about 45 of them trucks | `fb/run3/cl_*.txt`, `fb/corpus_cl_titles.txt` |

**Total: 119 examples** (67 Facebook, 52 Craigslist). Counts below are exact regex counts over these files, shown as FB-T / FB-D / CL. The corpus is small, so read the counts as relative signal, not as prevalence. Web-search snippets added nothing: `site:facebook.com/marketplace` was ignored and returned only dealer sites, so there is no snippet corpus.

## Facebook vocabulary

| Term (variants seen) | Meaning | Frequency FB-T / FB-D / CL | Example (paraphrased) | Recommendation |
|---|---|---|---|---|
| **kei** ("kei truck", "kei mini truck", "(kei truck)", "kei rhd", "kei firetruck") | Category word. Private sellers tack it onto the model name, often as "<model> kei truck". | 24 / 7 / 38 | "2000 Mitsubishi minicab kei truck" | text synonym → category; strip from title before model parsing |
| **mini truck** ("mini truck", "minitrucks", "Mini Japanese Kei Truck") | Same category. Common US-buyer term, often used with or instead of "kei". | 11 / 4 / 15 | "1994 Honda Acty Kei Mini Truck" | text synonym → category; strip as noise. Watch for collisions with Mazda B-series, S-10 and Mighty Max ("mini truck" in the 1980s US sense) |
| **4WD / 4x4 / "4 x 4" / "44" / AWD / "four wheel drive"** | Four-wheel drive. Dealers write "4WD", private sellers lean "4x4". One BC dealer writes "Carry 44". Honda's "AWD" in the "ACTY ATTACK AWD" title is also 4WD. | 4WD 6/4/19; 4x4 2/5/10 | "1993 Subaru sambar 4x4 ks4"; "Suzuki Carry 44 JDM Kei Truck with AC" | **filter** `drivetrain=4WD`; map every variant, including the standalone token `44` next to a model |
| **RealTime 4WD** | Honda Acty full-time 4WD branding | 1 / 1 / 0 | Acty SDX listing gives "RealTime 4WD / 5-speed" | facet value under drivetrain (Honda); text synonym → 4WD |
| **JDM** | Japanese-market import. Hype word. | 3 / 4 / 9 | "1998 Suzuki Carry Dump. JDM" | text synonym (import); noise-to-strip in titles |
| **RHD / right-hand drive** | Steering side. Almost always true, sometimes framed as "easy to learn". | 1 / 4 / 5 | "1999 Suzuki carry 4x4 mini truck kei rhd" | facet (steering), default RHD; text synonym |
| **year first, 4-digit** ("1995 …"); also "1980s …", "96 Subaru…", "99 Honda van" | Year phrasing. FB vehicle listings put year make model first, then " · " and a free-text trim. Dealer stock lists use 2-digit years. | year present 51 / 58 FB-T; 8 have no year | "1980s Mitsubishi Kei Truck"; "98 Subaru Sambar 4 x 4 dump" | **filter** year; parse "80s/1980s" as a range and 2-digit "9x" as 199x |
| **" · " trim separator** (FB-only) | FB's structured Year/Make/Model fields joined to the seller's free text | 10 / – / – | "1998 Subaru Sambar · Sambar SPECIAL 4WD" | parsing hint: left side = structured make/model, right side = free trim |
| **Lowercase / misspelled models** ("hijet", "carry", "acty", "mini cab" vs "minicab", "Carrry", "MiniCab") | Private sellers rarely capitalise; spellings vary | lowercase model 19 / 58; "mini cab" 1 vs "minicab" 5; "Carrry" 1 (FB-D) | "1994 Mitsubishi mini cab" | text synonym: case-fold, merge "mini cab", "minicab" and "MiniCab"; fuzzy-match a doubled letter |
| **Make-only titles** ("Mitsubishi kei truck", "Suzuki kei truck", "Kei mini truck", "Truck") | No model given (often Minicab or Carry) | make + "mini/kei truck" with no model: 4 Mitsubishi + 2 Suzuki; 1 just "Truck" | "Mitsubishi kei truck" | infer model from make (Mitsubishi→Minicab, Suzuki→Carry) with low confidence; flag for review |
| **Toyota-badged Hijet / Liteace** | Rebadge confusion: FB's make dropdown gives "Toyota" | 2 / 0 / 0 | "1999 Toyota DAIHATSU HIJET"; "2001 Toyota liteace kei firetruck" | text synonym → Daihatsu Hijet (Pixis/Liteace) |
| **Chassis code** (KS4, S38P) | Generation and 4WD code dropped into the title | 2 / 2 / 1 | "1991 daihatsu hijet S38P mini truck kei truck" | **filter**/facet (chassis); KS4 implies Sambar 4WD |
| **Trim names** (SDX, Attack, SPECIAL, Jumbo, twin cam) | Trim / cab variants | SDX 2/1/0; Attack 1/0/2; Jumbo 0/0/2 | "Honda Acty 4WD Attack Mini Truck"; "Hijet jumbo cab 4wd" | facet (trim); Jumbo → cab=extended |
| **Body / upfit** (dump, fire truck / firetruck / fire pump, bucket, crane lift, deck van, high top) | Special bodies; fire trucks are a niche of their own | dump 1/2/0; fire 2/1/2; bucket 0/1/1 | "Fire Truck for little fires" (Hijet); "3-way dump"; "BUCKET KEI TRUCK" | **facet** body_type (flatbed default, dump, fire, bucket/aerial, crane, van) |
| **A/C, "w/ AC", "factory ac", "air-conditioning"** | Air conditioning (often missing on 90s trucks, so it is a selling point) | 1 / 3 / 5 | "1993 Suzuki Carry w/ AC Kei Truck"; one seller pre-empts "no factory AC" | **filter** (has_ac, yes/no/unknown) |
| **5-speed / "5spd" / manual / "5 speed manual"** | Manual transmission | 0 / 7 / 4 | "5speed manual, 4x4" | **filter** transmission; FB vehicle cards also give "Manual transmission" as a field |
| **automatic / "Auto transmissions"** | Automatic (dealers advertise it as a premium) | 1 / 4 / 1 | dealer: "Hijet twin cam, 4x4 automatic with air conditioning" | facet transmission=AT |
| **Low range / "extra low" / "hi and low" / "low gear"** | Transfer case low range (Carry/Sambar "EL" gear) | 0 / 2 / 1 | "1993 Subaru Sambar 4WD - 5-Speed + Extra Low" | facet (low_range); text synonym |
| **Diff lock / "DIF-LOCK" / differential lock** | Locking rear differential | 0 / 1 / 3 | "2001 DAIHATSU HIJET 4WD DIFF LOCK KEI TRUCK" | **filter** (diff_lock); merge the spellings |
| **Lifted / "2" LIFTED" / "2-inch suspension lift"** | Lift kit | 0 / 3 / 2 | "2003 SUZUKI CARRY 4WD 2" LIFTED KEI TRUCK" | facet (modified/lifted) |
| **660cc** | Kei engine displacement (spec filler) | 0 / 2 / 1 | "660cc gas engine… over 65 mph" | noise-to-strip (constant across the category) |
| **Miles formats** ("57K miles" FB subtitle, "35,415 Miles", "~39,500 Miles", "31k mi", "ONLY 5Kmi", "92K") | Odometer. FB stores it as a structured subtitle. Craigslist uses "Nk mi". | FB-T subtitles on about 37/60 cards; FB-D 7; CL titles mostly via the odometer field | "1997 Daihatsu Hijet FIRE TRUCK 4x4 EFI 5spd ONLY 5Kmi" | **filter** mileage (mi); parse K suffixes, "~", and "Kmi" with no space |
| **km + conversion** ("63,705 km (~39,584 miles)") | Japanese odometer in km; sellers convert | 0 / 1 / 1 (Kmi) | Acty SDX spec block | filter: normalise km→mi and keep the raw value |
| **Clean title / "clean transferable street title" / "Clean SC Title in hand"** | Title status. FB's vehicle form shows "Clean title" as a field. | 1 / 4 / 0 | "Honda Acty SDX … – Clean Title (~39,500 Miles)" | **filter** title_status (clean / state title / bill of sale / none) |
| **Title in hand** | Title held now, not "pending" | 0 / 1 / 0 | "Clean SC Title in hand" | facet title_status=in_hand; text synonym |
| **State title** ("Sold with Washington state title", "SC title") | Already titled in a US state | 0 / 2 / 0 | dump truck: sold with WA title, shipping pending | facet title_state |
| **No title / bill of sale only** | No title; buyer must title it | 0 / 1 / 0 | 1986 Acty project: no title, bill of sale only | **filter** title_status=no_title (important buyer exclusion) |
| **Street legal / road legal ("in SC")** | Legality claim; usually state-specific | 0 / 2 / 5 | "Street legal in SC"; dealer template "Road Legal ATV UTV Kei" | facet (claimed_street_legal + state); never assert it as fact |
| **ATV / UTV / SxS / ATC** (in titles) | Keyword stuffing to catch off-road shoppers | 0 / 0 / 6 | "…4wd kei rhd truck atc atv sxs utv" | noise-to-strip; text synonym (search recall only) |
| **Farm / property / hunting** use | Use-case words (not legality) | farm 0 / 2 / 0 | "farm work, hunting trips, property management"; "comes with farm wheels" | text synonym (use-case tags); "farm wheels" = ag tires (feature) |
| **Imported / "recently imported" / "JDM Import" / "pending shipping 4 week eta"** | Import status; some FB listings are pre-sales still in transit | 0 / 2 / 3 | dump truck: pending shipping, about a 4-week ETA | facet availability (in_stock / in_transit) |
| **Project / not running / "does not run, must tow" / "Mechanic Special"** | Non-runner | 0 / 1 / 2 | "1998 Daihatsu Hijet 4x4 Mini Truck - 5 Speed - Project / Not Running" | **filter** condition=non-running |
| **FB condition field** ("Used - Fair", "Used - Good", "Used - like new", "Very good condition") | FB's structured condition picker | 6 of 8 item pages | – | facet condition (map to 3–4 buckets) |
| **Cash / "8k cash" / "Cash only"** | Payment terms | 0 / 3 / 0 | "Sold with WA title, 8k cash" | noise-to-strip (could be a seller-terms tag) |
| **Trade / "trades" / "sale or trade" / "trade for Corvette"** | Open to trade | 0 / 3 / 0 | Sambar owner "testing the waters", wants a C3/C5 Corvette or Datsun Z | facet (open_to_trade) or tag; otherwise strip |
| **Firm** ("Firm on price") | No negotiation | 0 / 1 / 0 | Hijet project: firm, wants back what was paid | noise-to-strip |
| **OBO** | Or best offer | 0 / 0 / 1 (CL Dallas, beside location) | "Hijet 4x4 … Project / Not Running — OBO" | noise-to-strip; optional negotiable tag |
| **Low balls / "no lowballers" / "stupid questions… blocked"** | Seller attitude | 0 / 1 / 0 | Acty seller: low offers and silly questions will be ignored | noise-to-strip |
| **"Serious inquiries only" / "Yes, it is available" / "DM me"** | Boilerplate | 0 / 3 / 0 | – | noise-to-strip |
| **Price drop (struck-through old price)** | FB shows the original price crossed out | 20 of 60 cards | "$6,750 ~~$8,000~~" | store original_price → "price dropped" badge |
| **Dealer placeholder prices** ($123,456, $1, $1,234) | Fake price; the real prices are in the body or on a site | FB 1 ($123,456 dealer stock list), CL 5 ($1, nwminitrucks template), FB 1 ($1,234, non-kei) | dealer: "Largest and best selection… $123,456 · In stock" | **noise-to-strip**: treat prices ≤ $100 or obvious patterns (123456, 1234, 1) as "call for price" |
| **Inline price formats** ("8k cash", "$10 990", "10 990.", "7995.", "$15,500") | Free-text prices in bodies, spaced or with no $ sign | FB-D 3 bodies | dealer stock list writes prices as "10 990" / "7995" | parser: accept "Nk", space thousands separators, and a missing "$" |
| **"In stock" / "Now have 13 in stock" / stock "#43" / website as location / ALL CAPS template titles** | Dealer tells | FB 1; CL about 30 (Langley dealer: "YEAR MAKE MODEL 4WD KEI TRUCK"; "#43"; "www.nwminitrucks.com" as location) | "2006 SUZUKI CARRY 4WD KEI TRUCK" | classifier signal for seller_type=dealer |

### Private seller vs dealer phrasing (observed)
- **Private sellers (FB):** lowercase titles with a model plus "kei truck"; first-person stories ("I've owned it, customized it"); pre-emptive Q&A ("Yes, it is available. No factory AC."); payment and attitude terms (cash only, firm, trades, low balls blocked); explicit title caveats (bill of sale only, state title). One "private" seller has 50 reviews and lets buyers test drive "different models", so he is a curbstoner/flipper. Expect high-review Marketplace sellers to be small dealers.
- **Dealers:** spec-template titles, often ALL CAPS, in the form YEAR MAKE MODEL 4WD [feature] KEI TRUCK; marketing copy ("RARE JDM COMMERCIAL UTILITY", "turn heads"); a business address in the body; stock numbers; placeholder prices ($1, $123,456) with a multi-truck stock list in the body; keyword stuffing ("Road Legal ATV UTV Kei"); "In stock"/"Now have 13".
- **FB-specific structure:** vehicle-category listings expose fields: mileage ("Driven 42,050 miles"), transmission, exterior/interior colour, fuel type, condition, "Clean title" plus "no significant damage". Listings posted under Classifieds/Commercial Vehicles have only free text and a Condition picker. Prefer the fields when present.

### Facebook access log (Browser Farm)
Tool: `tools/bfwalk.mjs`, 3 sessions, 18 page loads in total (15 facebook.com, 3 craigslist), about 15 s per page, WAIT_MS default. Every run returned `errors: []` and released its session (`release 200`). No login, no account, no joins, no posts or messages, no consent clicks. The credential file was not read.

| Run | Load # | URL | Result |
|---|---|---|---|
| run1 | 1 | /marketplace/nyc/search?query=kei%20truck | HTTP 200, no redirect. **Dismissible "See more on Facebook" login modal overlaid at once** (email/password plus a close X). All 15 cards were visible behind it and present in innerText and HTML. |
| run1 | 2 | /marketplace/dallas/search?query=kei%20truck | Same overlay; 15 cards readable |
| run1 | 3 | /groups/651842066713540/ (Mini Truck Marketplace) | 200, same overlay. **Only 1 post was rendered** (latest, and off-topic: wooden shingles). The feed does not paginate logged out. The About text was visible. |
| run1 | 4 | /groups/991776501024817/ (JMT For Sale) | 200, overlay. 1 featured post (a dealer Hijet bucket truck) was readable up to "See more". |
| run1 | 5 | /groups/1176504773754130/ (Kei Truck Owners) | 200, overlay. 1 featured post (a scam warning, not a listing). |
| run1 | 6 | /marketplace/seattle/search?query=mini%20truck | Overlay; 15 cards |
| run2 | 7–11 | /marketplace/item/<id>/ ×5 | 200, overlay. **The full listing rendered behind it**: price, struck-through price, condition, vehicle fields, seller description (sometimes cut at "See more" in innerText; the remainder was still in the DOM for most), seller first name and reviews (not copied). `<title>` is cut at about 50 chars. |
| run2 | 12 | /marketplace/atlanta/search?query=kei%20truck | Overlay; 15 cards |
| run3 | 13–15 | /marketplace/item/<id>/ ×3 | Same as 7–11 |
| run3 | 16–18 | craigslist dallas/seattle/atlanta search | Rendered cleanly. (WebFetch gets a 301 to `www.craigslist.org/search/area/<city>`, which Browser Farm follows.) |

**Login-wall summary:** on every load from the 1st onward it was the same soft wall: a client-side modal overlay, never a redirect to /login, never blank, never "content isn't available". It did not escalate across 15 FB loads in 3 sessions. Content is fully readable via innerText/HTML. Hard limits logged out: search shows **15 results per query with no scroll or pagination** (a "See more on Facebook" footer); **group feeds show 1 post**. The search HTML embeds GraphQL JSON (`marketplace_listing_title`, listing id, `custom_sub_titles_with_rendering_flags` = mileage like "57K miles", plus strikethrough price). That is the best extraction target, better than innerText.

**Browser Farm quirks/issues:** none blocking. Notes for feedback: (1) a page takes about 15 s even when the content is ready early (WAIT_MS fixed at 7 s plus navigation), so a run of 6 URLs takes 1.5–2 min; (2) the screenshot captures the modal, so a "dismiss overlay before screenshot" option would make PNGs useful; (3) a full-page PNG is produced but shows the same overlay. Seller names, faces and reviews are present in the captures (raw files under `fb/run*/`), so treat those raw files as sensitive and do not publish them.
