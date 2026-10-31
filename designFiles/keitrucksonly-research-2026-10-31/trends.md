# Google Trends: kei truck vs mini truck vs k truck (US), pulled 2026-10-31

Source: Google Trends Classic Explore, rendered via The Browser Farm. Numbers come from the /trends/api/widgetdata/* JSON the page loaded (not read off a screenshot). All values are Trends' 0-100 relative index within each query set. They are not search volumes.
Raw data: scratchpad/bf/out/{t5y,t12m,fs5y}.net.json; parser at scratchpad/bf/parse.py

## 1. Plain terms: kei truck / mini truck / k truck / japanese mini truck

### Averages (relative index)
| Window | kei truck | mini truck | k truck | japanese mini truck |
|---|---|---|---|---|
| 5y avg (weekly) | 8.5 | 18.4 | 6.0 | 1.1 |
| 12m avg | 13.5 | 32.9 | 9.7 | 1.2 |
| Last 4 weeks (Oct 2026) | ~11-13 | ~17-19 | ~7-8 | 1 |

Yearly avg: kei 1.4 (2021) -> 2.5 -> 8.6 -> 9.4 -> 10.2 -> 13.6 (2026 YTD). mini 12.6 -> 12.9 -> 15.0 -> 15.1 -> 17.1 -> 35.5. k truck 3.4 -> 4.0 -> 4.9 -> 5.3 -> 6.8 -> 10.1.

- Raw "mini truck" shows about 2x the volume of "kei truck", but a lot of it is unrelated. Its related queries include mini food truck, mini monster truck, mini box truck, Tractor Supply/Massimo rideable mini trucks, toy/LEGO trucks, "nyt mini", "starlink mini" and "zukes mini". Its 2026 avg of 35.5 comes from a Mar 29 – Jun 2026 spike (peak index 100 the week of Apr 5). Kei truck and k truck did not move in that window, so the spike is not kei-truck demand. Likely Slate/Telo/Massimo-type news or noise (inferred).
- Kei truck has the strongest growth: about 9-10x from 2021 to 2026, with step changes in Jan 2023, Jun 2023 and Dec 2025 (5y peak in the week of Dec 21-27 2025, at 22 vs mini 23).
- On the most recent weeks the gap is small: kei 11 vs mini 17, so mini truck is only about 1.5x.
- "japanese mini truck" is negligible, about 1/8 of kei truck.

### Seasonality (monthly mean 2022-2025, which skips the partial 2021 and the distorted 2026)
kei truck: Jan 7.1, Feb 6.5, Mar 7.3, Apr 8.5, May 8.8, **Jun 9.1**, Jul 7.9, Aug 7.2, Sep 6.6, **Oct 6.2 (low)**, Nov 7.1, **Dec 10.0 (peak)**.
-> Two peaks: Dec (holiday/gift and year-end news spikes) and Apr-Jun (spring buying). Low point is Sep-Oct. Seasonality is mild, about ±20-30%.
mini truck: flat (13-17). k truck: highest May-Jul.

## 2. Buyer intent: "<term> for sale" (5y)
| Window | kei truck for sale | mini truck for sale | k truck for sale | japanese mini truck for sale |
|---|---|---|---|---|
| 5y avg | 27.7 | 38.0 | 9.2 | 2.4 |
| 12m avg | 37.8 | 46.6 | 14.8 | 1.7 |
| Last 13 wk | 32.2 | 36.6 | 11.2 | 1.1 |
Yearly: kei-for-sale 3.2 (2021) -> 11.1 -> 35.1 -> 30.5 -> 29.4 -> 38.3. mini-for-sale stayed flat at 34-40 (47.9 in 2026, which is spike-inflated).
- **On buyer intent, kei truck is about equal to mini truck now** (ratio about 0.8-0.9). It was about 0.1 in 2021. Mini-for-sale is flat; kei-for-sale is growing. 5y peak was the week of Jun 18-24 2023 (kei-for-sale 100 vs 51).
- Related queries for "mini truck for sale" are rising toward kei: "kei trucks for sale near me" +400%, "kei truck for sale" +200%, "japanese kei truck for sale" +200%. "k truck for sale" also has kei-related queries rising (+400-900%), plus "k-truck for sale" as a breakout.

## 3. Top states (subregion index, 5y unless noted)
**kei truck** (5y): Hawaii 100, Washington 64, Vermont 61, Alaska 61, New Hampshire 59, Utah 54, Idaho 52, Montana 44, Wyoming 43, Colorado 43, Oregon 41, Arizona 41, Maine 40, North Carolina 39, New Mexico 36.
**kei truck** (12m): Hawaii 100, Vermont 83, NH 81, Alaska 76, Utah 76, Idaho 73, Washington 66, Montana 62, Oregon 59, Arizona 59, Maine 57, NM 56, Wyoming 53, Colorado 51, NC 50.
**kei truck for sale** (5y): Hawaii 100, Utah 94, Washington 76, Idaho 76, Vermont 70, Alaska 70, Colorado 64, Montana 64, NH 64, Arizona 58, ND 58, Maine/NM/Oregon/CT 52.
**mini truck** (5y): Wyoming 100 (outlier), Alaska 41, Hawaii 38, Utah 38, Montana 38, ND 37, Idaho 37, WV 37, Vermont 35, NC 35, TN 34, WA 34, KY 33.
**mini truck for sale**: Wyoming 100, Alaska 79, ND 79, SD 70, Hawaii 70, Montana 66, Idaho 66, Vermont 62, WV 62, NH 62.
**k truck**: Wyoming 100, Montana 82, Alaska 61, Hawaii 59, Vermont 58, SD 58, Idaho 58, Kansas 56.
Term share within each state (5y, kei/mini/k/jmt): kei truck's share is highest in Hawaii (41/42/13/4), WA (34/50), NH (34/48), CO (32/50), VT, UT, ID. Mini truck's share is highest in WY (72), KY (62), GA (61), and the South/Midwest (LA, MO, NY, ND, WV around 60). k truck's share is highest in MT, KS and MI (23).
Note: these indexes are per capita (search share), not totals. Populous states (TX, CA, FL, NC, PA) rank low on share but probably lead on absolute volume (inference; Trends does not show absolute numbers).

Pattern: the Mountain West (UT, ID, MT, WY, CO, AZ, NM), the Pacific NW (WA, OR), northern New England (VT, NH, ME), plus AK and HI. These line up with rural/farm/hunting use and states where kei trucks are road-legal or tolerated (inferred). Kei wording dominates in the West and New England; "mini truck" dominates in the South and Midwest.

## 4. Related queries
**kei truck top (5y):** kei truck for sale (100), kei trucks, honda kei, mini truck, mini kei truck, honda kei truck, japanese kei truck, kei car, suzuki truck, kei trucks for sale.
**kei truck rising (5y):** breakouts: slate truck, ford maverick, telo truck, "are kei trucks legal in the us", rivian, toyota hilux champ, **kei truck for sale indiana**, carfromjapan/carsfromjapan, time attack kei truck. Also: how much is a kei truck +300%, **kei truck for sale colorado** +200%, 6x6 kei truck +160%, how to buy a kei truck +150%.
**kei truck rising (12m):** forza horizon 6 kei truck (breakout), reo trucks (breakout), kei truck gta +850%, mitsui +300%, **trump kei truck +250%** (news), carfromjapan +130%, toyota hilux champ +130%, kei truck specs +70%, best kei truck +50%, kei truck price +40%.
**kei truck for sale rising (5y):** breakouts: facebook marketplace, **kei truck for sale los angeles**, kei truck weight, how much is a kei truck, k truck for sale near me, slate truck.
**japanese mini truck rising:** electric mini truck +250%, kei van +250%, japanese kei truck for sale +170%.
**k truck:** noisy (circle k, k-cups, kpop demon hunters, kia k4), but its rising list is moving toward kei (honda kei truck +3700%, kei trucks +1350%, "ktruck" and "k-truck for sale" breakouts).

## 5. Implications (my interpretation)
- Domain and brand: "kei truck" is the right head term. It is the growing term and the cleanest signal, and on "for sale" intent it is about equal to "mini truck" while mini truck is flat. Keep "mini truck" and "japanese mini truck" as secondary keywords in titles and H1s, e.g. "Kei Trucks for Sale (Japanese Mini Trucks)". That captures South/Midwest searchers who use "mini truck".
- Long-tail pages worth building: state/city "kei truck for sale <state/city>" (Indiana, Colorado, LA already rising); "are kei trucks legal in <state>"; "how much is a kei truck" / price guides; "kei truck for sale near me"; per-model pages (Honda Acty, Suzuki Carry, Daihatsu Hijet, Toyota Hilux Champ); kei van; electric mini truck.
- States to prioritise by interest share: HI, UT, WA, ID, VT, NH, AK, CO, MT, AZ, OR, ME, NM. Add TX, CA, FL, NC, PA for absolute volume (inferred). Make sure the "mini truck" wording is on pages for the South/Midwest.
- Timing: launch or run promotions before the Apr-Jun spring peak and the Dec spike. Sep-Oct is the low point.
- Watch: Slate/Telo/Ford Maverick appear in rising queries. Small-truck shoppers cross-shop new US small trucks, which could be content or SEO opportunities.

## Method / Browser Farm notes
- The first direct load of the /trends/explore URL in a fresh Browser Farm session returned **Google 429** ("too many requests"). Retrying after 60s with a warm-up load of trends.google.com/trends/?geo=US first (to pick up cookies, ~8s wait) then explore worked on all 3 runs (bf2.mjs = bf.mjs + warm-up).
- Classic Explore shows a "Classic Explore is expiring soon" banner. The /trends/api/widgetdata endpoints still work for now, but this scraping path may break when Google retires Classic Explore.
- The 12m run's final URL dropped `date=today 12-m`. It still returned 53 weekly points (the default is past 12 months), so the data is valid.
- A reCAPTCHA enterprise script loads on the page but no challenge was served.
