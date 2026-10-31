# keitrucksonly

This repo (the ShuttleMentor codebase with history) is becoming keitrucksonly.com, a free kei truck listings aggregator.

- Project context lives in `wiki/`. Start at `wiki/index.md`; grep `wiki/` for anything else (dealers, state laws, decisions, competitors).
- Page rules are in `wiki/README.md`. Decisions are numbered in `wiki/decisions.md`.
- To add information, drop a dated note in `wiki/inbox/` as described in `wiki/README.md`; do not edit wiki pages mid-task.
- At the start of every session, if `wiki/inbox/` has any `*.md` notes, first delegate a background subagent (a cheaper model is fine) to merge them per `wiki/CONSOLIDATE.md`, then continue with the user's request. No scheduled job.
- Never put secrets (e.g. Browser Farm keys) in the repo or wiki.
- Raw research and plans are in `designFiles/`; leave them unedited from wiki runs.
