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
what its tests pin down. All Phase 1 milestones (M0–M6) are shipped; Phase 2
(M7–M14, below) is planned.

| #  | Scope |
| -- | ----- |
| M0 | Scaffold: Astro project, CI (lint, typecheck, test), layout shell + design tokens, pipeline skeleton fetching one CoinGecko endpoint into `/data`, basic price chart, Pages deploy |
| M1 | Volatility & risk: rolling 30/90/365d realized vol, max drawdown curve, Sharpe/Sortino vs S&P 500 and gold |
| M2 | Halving cycles: price normalised to days-since-halving, four-cycle overlay, log scale toggle |
| M3 | Correlation: 90d rolling correlation matrix (BTC vs S&P 500, gold, DXY) with per-pair time-series view |
| M4 | DCA simulator: weekly/monthly DCA vs lump sum from arbitrary start date, fees included, fully client-side |
| M5 | Flows & dominance: BTC dominance vs stablecoin total supply; exchange netflow only if a free source exists, otherwise drop |
| M6 | Polish & ship: dark/light mode, live ticker island, OpenGraph cards, production deploy, and a README covering architecture, metric methodology, and a matter-of-fact "How this was built" section: Claude Code against a milestone plan, one PR per feature, fixture-tested metrics, human review at PR boundaries |

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
| M9  | 3 | **Correlation regimes**: extend pair histories to the full shared range (Yahoo `range=max`, FRED 10y), rolling 90d correlation over years rather than one, with shaded high/low-correlation regime bands and a regime-duration table | deepens M3; the "one deep quant feature"; benchmark dataset gains a long-history variant (separate file, keeps the 460d one small) |
| M10 | 4 | **GBP re-denomination (pipeline)**: daily GBP/USD history (Yahoo `GBPUSD=X`, FRED `DEXUSUK` fallback) with a documented carry-forward rule for weekends and holidays, then every BTC-denominated dataset rebuilt from GBP closes — price, history, monthly returns, cycles, risk, correlations — committed alongside the USD ones | display conversion is not enough: a GBP investor's drawdown, volatility and monthly returns genuinely differ, so metrics are recomputed from the converted series rather than relabelled. Stablecoin supply and total mcap stay USD (USD-pegged by definition); DXY stays a dollar index with a note; hash rate, tx counts and sat/vB fees are currency-free. `/data` roughly doubles (~1.3 → ~2.4 MB), keeping committed JSON the source of truth |
| M11 | 5 | **GBP routes & switcher (site)**: `[currency]` static routes (`/gbp/volatility/` …) via `getStaticPaths`, a header currency switcher that is a plain link, per-page labelling, and a methodology note covering the carry-forward rule and what stays USD | one currency per built page means zero client JS and no bundle doubling — a client-side toggle would ship both datasets to every chart island. First change touching every page and every derived dataset, so the verification gate matters more than usual |
| M12 | 6 | **Holdings (personal)**: local-only BTC amount + optional cost basis in localStorage; header value tile, P&L vs cost basis, holdings line on the DCA chart, explicit "stored only in your browser" note | no new sources; fully client-side island reusing pipeline functions — a new island class, so CLAUDE.md's island list is amended in the same PR; privacy stance documented on-page — the personal-use anchor |
| M13 | 7 | **Signals & feed**: pipeline-computed daily signal states (vol regime crossings, drawdown thresholds, new cycle highs, dominance moves) committed to `/data`, a signals section on the overview, and generated `rss.xml` + `feed.json` for readers/automation | pure threshold fns over existing datasets; personal daily-brief utility without breaking the static model |
| M14 | 8 | **App-grade polish**: PWA manifest (installable on phone) + offline caching of the last committed dataset, Lighthouse CI job with README badge, reduced-motion + print styles, `/methodology` page aggregating all formulas, README demo GIF | portfolio rigor + phone-first personal use; ship as "2.0" |

Sequencing rationale: M7 is a fast visual win; M8 adds the highest daily
utility; M9 is the depth piece worth writing about; M10–M11 add GBP (before
the personal features, so holdings and signals are not retrofitted for
currency); M12–M13 turn the site into a personal dashboard; M14 packages it.
The cut line sits after M11: M12–M14 are the plan's flex if priorities
change.

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
