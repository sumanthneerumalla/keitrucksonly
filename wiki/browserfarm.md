---
title: The Browser Farm (dogfooding)
type: topic
tags: [infra, browserfarm]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-handoff.md, designFiles/keitrucksonly-research-2026-10-31/facebook.md, designFiles/keitrucksonly-research-2026-10-31/trends.md, designFiles/keitrucksonly-research-2026-10-31/dealers.md]
---
**Summary:** The owner's product: cloud Chromium with a Browserbase-compatible API. Use it whenever plain search/fetch isn't enough (D-011) and report blockers to the owner.

## API
- Base URL `https://api.thebrowserfarm.com`; auth header `X-BB-API-Key` (or `Authorization: Bearer`). (2026-10-31, handoff)
- Key minting (device flow): `POST https://www.thebrowserfarm.com/api/device/code`, owner approves in browser, then `POST https://www.thebrowserfarm.com/api/device/poll`. Use `www.`; the bare domain 301s and breaks POST. (2026-10-31, handoff)
- Key lives in `~/.config/browserfarm/credentials` (chmod 600). Never write the key into the wiki, repo or chat. (2026-10-31, handoff)
- Session: `POST /v1/sessions` -> `connectUrl` -> Playwright `connectOverCDP`. Release: `POST /v1/sessions/{id}` with `{"status":"REQUEST_RELEASE"}`. (2026-10-31, handoff)
- No residential egress yet, so Reddit/Facebook may still block. (2026-10-31, handoff)

## Findings from dogfooding (2026-10-31)
- Google Trends: cold load returns 429; cookie warm-up plus a 60 s retry works. Classic Explore is being retired. (trends.md)
- Facebook logged out: `/groups/<id>/about` works, even for private groups (members, rules, admins). Bare `/groups/<id>/` hits a login wall after ~6 parallel loads. (facebook.md)
- Brave `site:` search works but shows a CAPTCHA after ~18 queries; not bypassed. Bing ignores `site:`; DuckDuckGo HTML returned nothing. (facebook.md)
- old.reddit needs login; new reddit renders. (facebook.md)
- Dealer-site runs took one session each, ~15-25 s; no blocks on Mayberry, Weatherford, NW Mini Trucks. (dealers.md)

## Helper script issues (our helper, not the product)
- Captured only responses with a JSON content-type; Mayberry's API sends JSON as `text/plain` and was missed. (dealers.md)
- Truncated bodies at 200,000 chars (Weatherford's 610 KB response). (dealers.md)
- No argument validation: an empty output prefix produced a `unsupported mime type "null"` error and orphan files. (dealers.md)

## Rule
- Blockers found while dogfooding go to the owner (D-011, see [[decisions]]).
