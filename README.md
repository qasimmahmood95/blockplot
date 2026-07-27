# blockplot

Bitcoin financial analytics as a fully static site. A scheduled GitHub Actions
pipeline fetches market data, validates it with zod, derives every metric in
tested pure TypeScript, and commits versioned JSON to `/data`; Astro builds
the site from that dataset alone, charted with Observable Plot.

**Status:** Phase 1 (M0–M6) shipped; Phase 2 in progress (M7–M10 done, M11–M14 planned).
[PLAN.md](PLAN.md) holds the milestone plan, [CLAUDE.md](CLAUDE.md) the
development rules.

**Live:** https://qasimmahmood95.github.io/blockplot/

## Architecture

```
pipeline/   fetch → validate → transform scripts; metrics are pure, unit-tested functions
data/       versioned JSON committed by the pipeline workflow (github-actions[bot])
src/        Astro site; builds exclusively from /data
.github/    ci.yml (lint · typecheck · test · build), pipeline.yml (6 h cron + pipeline-code pushes), deploy.yml (Pages)
```

- **Static output only.** Every figure on the site is baked at build time from
  `/data`. Exactly two runtime fetches are sanctioned, and both render a
  committed value first and upgrade it on success: the header ticker (spot
  price) and the network page's fee tiers (which move on a ~10-minute
  timescale, so a 6-hourly snapshot would be stale on arrival).
- **The pipeline is the only writer of `/data`.** It runs 6-hourly (and on
  pushes that change pipeline code, so new datasets get seeded by the bot on
  the branch that introduces them), validates every source response and every
  on-disk dataset with zod, and commits as `github-actions[bot]`.
- **Client islands only where interactivity demands them**: the charts, the
  DCA simulator (which runs the pipeline's own fixture-tested functions in
  the browser), the live ticker, and the fee tiers.
- **Two display currencies, USD and GBP.** USD pages live at the root, GBP
  under `/gbp/`, with a header switcher that holds your place on the page.
  GBP is a re-denomination, not a relabelling — see below.
- **Hosting is swappable**: the deploy step is isolated in
  `.github/workflows/deploy.yml`.

### Data sources (all keyless)

| Source | Serves |
| ------ | ------ |
| CoinGecko | BTC daily closes (365d window), live spot, global mcap/dominance snapshot |
| blockchain.com charts | full BTC daily history from 2010 |
| FRED `fredgraph.csv` | S&P 500 daily closes |
| Yahoo Finance chart API | gold (XAU/USD spot, `GC=F` fallback), DXY (`DX-Y.NYB`, `DX=F` fallback) |
| DeFiLlama | total USD-pegged stablecoin circulating value, full history |
| mempool.space | recommended fee tiers (committed snapshot + the network page's live refresh) |
| FRED `DEXUSUK`, Yahoo `GBPUSD=X`, ECB via Frankfurter | GBP/USD daily rates, merged |

Historical BTC dominance has no keyless source, so `data/dominance.json`
accretes one snapshot per UTC day. Exchange netflow was dropped — no free
source exists. Sourcing decisions and dead ends are recorded in PLAN.md.

## Metric methodology

All maths lives in pure functions under `pipeline/`, unit-tested against
fixed fixtures with exact, independently derived expected values.

- **Returns** are daily log returns, `ln(Pₜ/Pₜ₋₁)`.
- **Realized volatility**: sample standard deviation (n−1) of daily log
  returns, annualized by √365 for BTC and √252 for market-hours assets,
  shown as a percentage. Rolling curves use the window of returns ending at
  each date and derive from the full-history series so even the 365d window
  is populated.
- **Drawdown**: daily close relative to the running peak; the deepest
  drawdown keeps the first trough date and the peak it fell from.
- **Sharpe / Sortino**: annualized, 0% risk-free rate; Sortino uses target
  downside deviation below 0% over all observations. Benchmarks keep their
  own trading calendars clamped to BTC's 365-day window, so figures are
  indicative rather than strictly like-for-like.
- **Correlation**: Pearson on pairwise-aligned daily log returns (shared
  trading days; a gap in either calendar becomes one multi-day return) over a
  trailing 90-calendar-day window; windows with fewer than 40 shared returns
  or zero variance emit nothing.
- **Halving cycles**: price divided by the halving-day close per epoch
  (blocks 210000/420000/630000/840000), plotted against days since halving.
- **DCA simulator**: fixed fee-inclusive buys at daily closes, month-end
  clamping, undeployed cash counted toward wealth so an equal-budget lump sum
  from the same start date compares like-for-like; ignores taxes, slippage,
  and yield on idle cash.
- **GBP re-denomination**: each daily close is divided by *that day's*
  GBP/USD rate and every metric recomputed from the converted series — a
  GBP holder's drawdown, volatility and monthly returns genuinely differ
  from the USD ones, so converting the finished figures at today's rate
  would be wrong. Rates merge Yahoo (deep), FRED `DEXUSUK` and ECB
  reference rates (fresh), later sources winning per date. FX markets close
  at weekends and on bank holidays while BTC does not, so the last quote is
  carried forward; days before the first quoted rate are dropped rather
  than converted, and the pipeline warns if the rate tail lags BTC by more
  than 5 days. Converted closes are kept unrounded — a 2 dp round on a 2010
  sub-pound price is an error of up to 11% that would propagate into the
  monthly heatmap. The dollar index is never converted: it measures the
  dollar itself.

Rounding is applied at the serialization edge (2 dp percentages, 8 dp BTC,
4 dp multiples) and every page carries a methodology note for its own view.

## Develop

```
npm ci
npm run dev        # local site
npm test           # pipeline unit tests (fixture-based, exact assertions)
npm run typecheck  # astro check, strict TS
npm run lint
npm run build
npm run pipeline   # refresh data/ locally (normally done by CI; do not commit the output)
```

## How this was built

This repo doubles as a public showcase of AI-assisted development, run
matter-of-factly: Claude Code working against the milestone plan in
[PLAN.md](PLAN.md) — one pull request per milestone from M1 on, in order
(M0 scaffolded directly). Every metric
landed with fixture tests asserting exact expected values derived
independently of the implementation; every PR was gated on an automated
code review, an independent test/verification pass that recomputed the
shipped datasets from raw data, and CI (lint, typecheck, tests, build)
before merging. Human review happens at PR boundaries. Data refreshes are
committed only by `github-actions[bot]`, keeping automation clearly
separated from authored work; source-availability dead ends (stooq's
bot-check, FRED's discontinued gold series, keyless dominance history) are
recorded in the plan rather than hidden. Process artifacts — the plan, the
rules, the PR descriptions — are part of the repo.
