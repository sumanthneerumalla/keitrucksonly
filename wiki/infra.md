---
title: Infrastructure and repo
type: topic
tags: [infra]
updated: 2026-10-31
sources: [designFiles/keitrucksonly-handoff.md]
---
**Summary:** Self-hosted (D-009). Repo is the ShuttleMentor codebase with history; ShuttleMentor features stay in place (D-010).

- Stack: Next.js, tRPC, Prisma, Clerk, Stripe Connect. (2026-10-31, handoff)
- Hosting: reuse `serverFiles/` (Caddy, ddclient, pgbackrest, crontab). (2026-10-31, D-009)
- Repo: github.com/sumanthneerumalla/keitrucksonly (public). Working branch `claude/cool-dirac-hs1ezq`. (2026-10-31)
- Local worktree for this branch: `~/Desktop/keitrucksonly-dirac`. The main clone `~/Desktop/keitrucksonly` has uncommitted deletions on `main`; leave it alone. (2026-10-31)
- `origin` is HTTPS without stored credentials; push via SSH alias: `git push git@github.com-sumanth:sumanthneerumalla/keitrucksonly.git <branch>`. (2026-10-31)
- Project not yet renamed from ShuttleMentor in package.json / README. (2026-10-31)
