# blockplot

Bitcoin financial analytics as a fully static site. A scheduled GitHub Actions
pipeline fetches market data, validates it with zod, derives every metric in
tested pure TypeScript, and commits versioned JSON to `/data`; Astro builds
the site from that dataset alone, charted with Observable Plot.

**Status:** M5 (flows & dominance). [PLAN.md](PLAN.md) holds the milestone plan,
[CLAUDE.md](CLAUDE.md) the development rules. The repo doubles as a public
showcase of AI-assisted development — process artifacts are committed, not
hidden.

**Live:** https://qasimmahmood95.github.io/blockplot/

## Layout

```
pipeline/   fetch → validate → transform scripts; metrics are pure, unit-tested functions
data/       versioned JSON committed by the pipeline workflow (github-actions[bot])
src/        Astro site; builds exclusively from /data
.github/    ci.yml (lint · typecheck · test · build), pipeline.yml (6 h cron), deploy.yml (Pages)
```

## Develop

```
npm ci
npm run dev        # local site
npm test           # pipeline unit tests (fixture-based, exact assertions)
npm run typecheck  # astro check, strict TS
npm run lint
npm run build
npm run pipeline   # refresh data/ locally (normally done by CI)
```
