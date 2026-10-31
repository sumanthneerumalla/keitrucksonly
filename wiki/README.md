# KeiTrucksOnly project wiki

A small, LLM-maintained wiki (Karpathy "LLM wiki" pattern). It is the **single place to grep for project context**: decisions, dealers, state laws, competitors, research results, infra notes.

Three layers:
1. **Raw sources** (never edited by the wiki agent): `designFiles/` docs, `wiki/inbox/processed/` notes, external URLs.
2. **The wiki** (this folder): short markdown pages that summarise and cross-link the sources. Agents rewrite these.
3. **The schema** (this file + `CONSOLIDATE.md`): the rules.

## Layout
```
wiki/
  README.md        schema and page rules (this file)
  CONSOLIDATE.md   step-by-step daily runbook for the consolidation agent
  index.md         catalog of every page, one line each
  log.md           append-only history of wiki changes
  inbox/           drop zone for new notes (any agent or the owner)
  inbox/processed/ notes already merged, kept as raw sources
  tools/lint.py    checks links, index coverage, stale facts
  *.md             topic pages
  dealers/*.md     one page per notable dealer
```

## Adding information (any session, any agent, the owner)
Do **not** edit wiki pages directly in the middle of other work. Drop a note in `wiki/inbox/` instead:
- filename: `YYYY-MM-DD-short-slug.md`
- first lines:
  ```
  ---
  date: 2026-10-31
  source: session | owner | agent:<name> | url
  ---
  ```
- body: plain bullets of facts, decisions or questions. Say where each fact came from (URL, file, "owner said").

The daily consolidation run merges inbox notes into pages. The owner may edit pages directly at any time.

## Page rules
- Filenames are lowercase-kebab and **unique across the whole wiki** (so `[[name]]` links resolve without a folder).
- Link other pages with `[[page-name]]` (no `.md`, no folder).
- Every page starts with frontmatter:
  ```
  ---
  title: Mayberry Mini Trucks
  type: dealer | topic | log | index
  tags: [dealer, state/NC, ingest/json-api]
  updated: 2026-10-31
  sources: [designFiles/keitrucksonly-research-2026-10-31/dealers.md]
  ---
  ```
- Then a one-line **Summary:**, then sections. Keep pages under ~150 lines; split when bigger.
- Facts are bullets ending with a date and source: `- 65 units live (2026-10-31, dealers.md)`.
- Facts with a shelf life (counts, laws, prices, member numbers) carry a date. Laws also carry `last_verified: YYYY-MM-DD` on the page.
- When a newer fact replaces an older one, move the old bullet under `## History` (don't delete it).
- When two sources disagree, keep both, prefix with `CONFLICT:` and add an item to [[open-questions]].
- Decisions go in [[decisions]] with an ID (`D-007`). Never rewrite a past decision; add a new one that supersedes it.

## Tags (for grep)
`dealer`, `competitor`, `state/XX`, `ingest/shopify|woocommerce|json-api|sitemap|scrape|none`, `excluded`, `law`, `distribution`, `infra`, `decision`, `research`.

Example greps:
```
grep -rl "state/NC" wiki/
grep -rn "CONFLICT:" wiki/
grep -rn "^- D-" wiki/decisions.md
```

## Never
- Never put secrets in the wiki (API keys live in `~/.config/browserfarm/credentials` and env files).
- Never edit `designFiles/` or application code from a wiki run.
- Never invent facts. If unsure, ask in [[open-questions]].
