# blockplot — plan

Bitcoin financial analytics webapp, built as a production-quality public repo
and developed via milestones, one PR per feature. The repo doubles as a public
showcase of high-standard AI-assisted development: process artifacts (this
plan, CLAUDE.md, PR descriptions) are committed, not hidden.

Working name was `btc-analytics`; renamed **blockplot** before scaffolding.

## Stack

*(As planned before M0. Sourcing evolved during delivery — gold and DXY moved
to Yahoo Finance, full history to blockchain.com, and mempool.space was never
needed; the Known constraints section below records each decision.)*

- Astro + TypeScript (strict), static output only; client islands for
  interactive charts and the simulator.
- Observable Plot for charts.
- Data pipeline: a GitHub Actions workflow on a 6-hour cron runs typed
  TypeScript scripts that fetch CoinGecko (price/OHLC), mempool.space
  (on-chain), and FRED (S&P 500, gold, DXY), validate with zod, compute all
  derived metrics, and commit versioned JSON to `/data`. The site builds
  purely from `/data`.
- Pipeline commits are authored by `github-actions[bot]`, not the developer —
  automation stays clearly separated from human-directed work.
- One exception to static data: a small header ticker island fetches live spot
  price client-side (CoinGecko public endpoint).
- Hosting: GitHub Pages via Actions deploy; the deploy step is isolated in
  `.github/workflows/deploy.yml` so swapping to Cloudflare Pages later is a
  one-file change.

## Phase 1 milestones

One PR each, in order; every PR description documents scope, approach, and
what its tests pin down. Phase 1 (M0–M6) and Phase 2 (M7–M14, below) are both
shipped; the plan is complete.

| #  | Scope |
| -- | ----- |
| M0 | Scaffold: Astro project, CI (lint, typecheck, test), layout shell + design tokens, pipeline skeleton fetching one CoinGecko endpoint into `/data`, basic price chart, Pages deploy |
| M1 | Volatility & risk: rolling 30/90/365d realized vol, max drawdown curve, Sharpe/Sortino vs S&P 500 and gold |
| M2 | Halving cycles: price normalised to days-since-halving, four-cycle overlay, log scale toggle |
| M3 | Correlation: 90d rolling correlation matrix (BTC vs S&P 500, gold, DXY) with per-pair time-series view |
| M4 | DCA simulator: weekly/monthly DCA vs lump sum from arbitrary start date, fees included, fully client-side |
| M5 | Flows & dominance: BTC dominance vs stablecoin total supply; exchange netflow only if a free source exists, otherwise drop |
| M6 | Polish & ship: dark/light mode, live ticker island, OpenGraph cards, production deploy, and a README covering architecture, metric methodology, and a matter-of-fact "How this was built" section: Claude Code against a milestone plan, one PR per feature, fixture-tested metrics, human review at PR boundaries |

## Status

M0–M15 are shipped, one PR each, in order. M0–M14 were the plan as written;
M15 is the first row added after it, from a measurement rather than a roadmap
— see below. The two Phase-2 rows that changed
in flight are recorded rather than quietly rewritten: M9–M10 (multi-currency)
were pulled ahead on request, and a chart-tooltip fix was taken between M12 and
M13 after the overview turned out to be the only chart without one.

## Phase 2 milestones

Phase 1 built the showcase; Phase 2 makes blockplot a daily-use tool while
deepening the portfolio story. Same rules: one PR per milestone, in order,
each gated on automated review, independent verification, and CI; metric
maths stays pure and fixture-tested in `pipeline/`; keyless sources only;
personalization is local-only (localStorage), never committed or fetched.
Timeline assumes roughly one milestone per week; each is independently
shippable, so the plan can pause after any row.

| #   | Week | Scope | Sources / notes |
| --- | ---- | ----- | --------------- |
| M7  | 1 | **Monthly returns heatmap**: year × month grid of BTC monthly returns from full history, diverging pos/neg tinting, yearly totals column, on the overview or its own section | existing `btc-price-history.json`; pure monthly-aggregation functions; showcases the color system on a classic quant visual |
| M8  | 2 | **Network page**: hash rate and daily transaction count trends, plus current recommended fee tiers; closes the unused mempool.space thread from the Phase 1 plan | blockchain.com charts (hash-rate, n-transactions, keyless) via the pipeline; mempool.space `recommended-fees` — decide in the PR whether 6-hourly pipeline freshness suffices or a second sanctioned runtime island is warranted (CLAUDE.md amendment in the same PR if so) |
| M9  | 3 | **GBP re-denomination (pipeline)**: daily GBP/USD history (Yahoo `GBPUSD=X`, FRED `DEXUSUK` fallback) with a documented carry-forward rule for weekends and holidays, then every BTC-denominated dataset rebuilt from GBP closes — price, history, monthly returns, cycles, risk, correlations — committed alongside the USD ones | display conversion is not enough: a GBP investor's drawdown, volatility and monthly returns genuinely differ, so metrics are recomputed from the converted series rather than relabelled. Stablecoin supply and total mcap stay USD (USD-pegged by definition); DXY stays a dollar index with a note; hash rate, tx counts and sat/vB fees are currency-free. `/data` roughly doubles (~1.3 → ~2.6 MB), keeping committed JSON the source of truth |
| M10 | 4 | **GBP routes & switcher (site)**: `[currency]` static routes (`/gbp/volatility/` …) via `getStaticPaths`, a header currency switcher that is a plain link, per-page labelling, and a methodology note covering the carry-forward rule and what stays USD | one currency per built page means zero client JS and no bundle doubling — a client-side toggle would ship both datasets to every chart island. First change touching every page and every derived dataset, so the verification gate matters more than usual |
| M11 | 5 | **Correlation regimes**: extend pair histories to the deepest daily range available (~10y; Yahoo silently coarsens `range=max` to monthly bars, so granularity is asserted), rolling 90d correlation over years rather than one, with shaded high/low-correlation regime bands and a regime-duration table | deepens M3; the "one deep quant feature". Regimes use hysteresis (10 consecutive confirming readings, boundary dated at the first) — a bare threshold test reports dozens of one-day regimes per crossing. **Deviation:** no long-history benchmark file is committed. The plan called for one, but it is an input the site never renders, and the FX trim in M9 established the rule that `/data` carries what renders; one fetch per source now serves both the 460d window and the deep correlations. Pairs without BTC keep a 365d window — at full depth the three inter-benchmark pairs were over half the file, for a matrix that reads one number from each |
| M12 | 6 | **Holdings (personal)**: local-only BTC amount + optional cost basis in localStorage; header value tile, P&L vs cost basis, holdings line on the DCA chart, explicit "stored only in your browser" note | no new sources; fully client-side island reusing pipeline functions — a new island class, so CLAUDE.md's island list is amended in the same PR; privacy stance documented on-page — the personal-use anchor |
| M13 | 7 | **Signals & feed**: pipeline-computed daily signal states (vol regime crossings, drawdown thresholds, new cycle highs, dominance moves) committed to `/data`, a signals section on the overview, and generated `rss.xml` + `feed.json` for readers/automation | pure threshold fns over existing datasets; personal daily-brief utility without breaking the static model |
| M14 | 8 | **App-grade polish**: PWA manifest (installable on phone) + offline caching of the last committed dataset, Lighthouse CI job with README badge, reduced-motion + print styles, `/methodology` page aggregating all formulas, README demo GIF | portfolio rigor + phone-first personal use; ship as "2.0" |

Sequencing rationale: M7 is a fast visual win; M8 adds the highest daily
utility; M9–M10 add GBP, pulled ahead of the rest on request and in any case
best done before the personal features so holdings and signals are not
retrofitted for currency; M11 is the depth piece worth writing about;
M12–M13 turn the site into a personal dashboard; M14 packages it. The cut
line sits after M11: M12–M14 are the plan's flex if priorities change.

## After the plan

| #   | Scope | Why |
| --- | ----- | --- |
| M15 | **Charts rendered at build time**: every chart's Plot options extracted into one pure `spec` shared by build and browser, drawn to SVG with linkedom, colours moved to `var(--token)` so both themes work with no JS, and Plot loaded by dynamic `import()` only on the interaction that needs it. Plus the two accessibility defects the same investigation turned up. | Not planned — measured. M14's own Lighthouse job put the chart pages at a median 0.89 against 0.99 for the one page with no chart on it, and the gap was entirely the 88 KB of Plot each page loaded to draw data the build already had |

The plan proper ended at M14. This row is recorded here rather than folded
into M14 because it was found by the gate M14 shipped, which is the outcome
that gate was for: the milestone that adds the measurement is not the
milestone that gets to act on it.

### M16 — plan

M15 halved what a chart page costs and left three things on the table, all of
them measured rather than suspected. This is the plan for them; it is written
before the work so the reasoning can be reviewed rather than reconstructed.

**1. The payload, not the chart, is now the biggest thing on most pages.**
Splitting each built page into its inline `application/json` and its SVG:

| page | page gz | inline JSON | SVG |
| --- | --- | --- | --- |
| `/holdings` | 42.4 KB | **38.2 KB (90%)** | none |
| `/dca` | 62.3 KB | **38.1 KB (61%)** | 19.8 KB |
| `/correlation` | 54.0 KB | **30.3 KB (56%)** | 16.8 KB |
| `/cycles` | 76.6 KB | 28.3 KB (36%) | 44.0 KB |
| `/network` | 36.3 KB | 9.3 KB | 22.2 KB |
| `/` | 14.7 KB | 4.9 KB | 4.6 KB |

That payload exists for one reason: to feed the island when it upgrades. Since
M15 the upgrade is on demand — so the data it needs should be too. Each chart's
payload moves to a generated JSON route and is fetched beside Plot, on the same
interaction. `/holdings` is the clearest case: 90% of that page is a history
series for a chart that does not exist until the reader types an amount.

This adds a class of runtime fetch, so **CLAUDE.md's two-fetch rule is amended
in the same PR** — the rule requires it. The amendment is narrow and worth
stating precisely: the sanctioned pair (CoinGecko, mempool.space) are *live
external* reads whose whole risk is a cached value masquerading as current.
This is a same-origin read of a committed file that the build already
produced, on interaction, where failure leaves the served chart exactly as it
is. Different enough to allow, not so different that it goes unwritten.
The holdings privacy note enumerates the site's requests, so it is re-checked
against the built output by driving `dist/`, as that rule requires.

**2. The upgrade still shifts the layout.** Measured CLS 0.0346 at 360px and
0.0085 at 1280px, against 0 before M15. Cause: the served variant is laid out
at 400 or 760 and scaled to the container, so its displayed height is
`340 × width/400`, while the live chart re-renders at a fixed 340. Fix: the
live render takes the height the static one is *currently occupying*, so the
box never changes. `drawChart` measures and passes it, which keeps it in one
place rather than in ten components.

**3. The served SVG is drawn at more precision than a screen has.** `/cycles`
carries 4,991 points across four lines, 3.3 per pixel at the narrow width.
Prototyped: min/max-per-x-pixel-bucket downsampling — which preserves the drawn
envelope exactly, unlike naive decimation — gives 4,991 → 3,985 points and
21.7 → 17.9 KB gz on the narrow variant. The wide variant is already under two
points per pixel and is left alone. Applied to the **build-time render only**;
the live chart keeps every point, so a hovered value is never an approximation.

**4. Offline, charts render but the crosshair does not**, because the worker
caches what it has served and Plot is only fetched on a first hover. Item 1
extends that to the data. Two options, and the choice is not obvious:
prefetch Plot and the payload at idle (restores offline, makes the first hover
instant, keeps the critical path clear — but re-downloads ~84 KB for readers
who never hover), or leave it and keep the README's promise narrow. Deferred to
review rather than decided here.

**5. The Lighthouse ceiling.** Chart pages sit at a median 0.90 where the
chartless page reaches 0.99, and M15 proved the gap is not the JS payload:
`/holdings` shipped all of Plot before and none after and scored 0.90 both
times. Under diagnosis; scope set by what that finds, and "nothing worth
doing" is an acceptable answer if the numbers say so.

Same rules as every milestone: pure functions with fixture tests for anything
computed, one PR, gated on review, independent verification and CI.

## Testing

- Every metric calculation (volatility, drawdown, Sharpe/Sortino, correlation,
  DCA maths) is a pure function in the pipeline layer with unit tests against
  fixed known-input fixtures asserting exact expected outputs.
- CI runs on every PR; pipeline scripts are covered, not just UI.

## Design constraints

- Data-dense but hierarchical: one primary chart per view, compact stat grids,
  clear section separation.
- Distinctive, not generic: characterful heading typeface paired with tabular
  mono numerals; one unusual accent (burnt orange) on a neutral base; light
  and dark mode.
- Decoration welcome when specific to this app (block-height or spot ticker in
  header, fine chart gridline texture, number tween on load) — never stock
  decoration (purple/blue gradients, glassmorphism, emoji, hero sections).
- No marketing copy; text is labels, figures, methodology notes.

## Known constraints & open questions

- CoinGecko's keyless public API caps historical `market_chart` queries at the
  past 365 days (confirmed 2026-07-26, error 10012 on `days=max`), so M0 ships
  a 365-day window. Resolved in the M2 PR: full daily history (2010 onward)
  comes from blockchain.com's keyless charts API
  (`/charts/market-price?timespan=all&sampled=false`), which feeds the
  halving-cycle overlay and populates the previously empty 365d rolling-vol
  series (the vol curves now derive from that history source, documented on
  the page).
- FRED works keylessly via its `fredgraph.csv` export (the JSON API needs an
  account key), which serves the S&P 500 (`SP500`). FRED's LBMA gold series
  were discontinued in 2022 when IBA pulled redistribution, and stooq's CSV
  export sits behind a JavaScript bot-check for CI runner IPs (confirmed
  2026-07-26), so gold comes from Yahoo Finance's keyless chart API —
  XAU/USD spot, falling back to COMEX front-month futures (`GC=F`) — decided
  in the M1 PR. DXY (resolved in the M3 PR) also comes from Yahoo Finance:
  the ICE index `DX-Y.NYB`, falling back to front-month futures `DX=F`.
- M5 exchange netflow: dropped (decided in the M5 PR) — Glassnode, CryptoQuant,
  and peers all meter flow metrics behind keys; no keyless source exists.
  Historical BTC dominance is also keyless-unavailable (CoinGecko global
  history is pro-only), so data/dominance.json accretes one snapshot per UTC
  day from the 6-hourly pipeline instead; stablecoin supply history comes
  keyless from DeFiLlama.
