---
title: Decisions
type: log
tags: [decision]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-handoff.md, designFiles/keitrucksonly-gtm-playbook.md]
---
**Summary:** Owner decisions, newest at the bottom. Never edit a past entry; add a new one that supersedes it.

- D-001 (2026-10-31) Positioning: "Every kei truck for sale in the US, filtered to the ones you can actually register in your state." See [[positioning]].
- D-002 (2026-10-31) Free listings; every listing links out to the dealer; no commission, no payment handling (keeps the site outside dealer licensing).
- D-003 (2026-10-31) v0 scope: dealer inventory ingest, per-state registration filter, email-only saved-search alerts, 50-state law pages, self-computing price index, dealer claim/remove, auto-hide after 72 h unseen, weekly owner health email. See [[data-model]].
- D-004 (2026-10-31) Out of v0: user accounts, private sellers, payments, forum, regular articles, agent automation.
- D-005 (2026-10-31) v0 must be very low effort to build, maintain and run. No agents and no scrapers yet.
- D-006 (2026-10-31) Later ingest uses generic adapters (Shopify, WooCommerce Store API, JSON-LD/sitemaps), not per-site scrapers. See [[ingest]].
- D-007 (2026-10-31) keitruckdirect.com excluded from everything (likely fake dealer). See [[keitruckdirect]].
- D-008 (2026-10-31) New dealers are vetted before going live (domain age, phone area code vs address, payment terms, Maps/BBB).
- D-009 (2026-10-31) Hosting: self-hosted, reuse `serverFiles/` (Caddy, ddclient, pgbackrest, crontab). See [[infra]].
- D-010 (2026-10-31) Leave leftover ShuttleMentor features in place; no cleanup commit.
- D-011 (2026-10-31) Use The Browser Farm (owner's product) whenever plain search/fetch isn't enough, to dogfood it; report blockers to the owner. See [[browserfarm]].
- D-012 (2026-10-31) Project context lives in this wiki; a daily agent consolidates `wiki/inbox/` per `wiki/CONSOLIDATE.md`.
