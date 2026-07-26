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

## Milestones

One PR each, in order; every PR description documents scope, approach, and
what its tests pin down. All milestones (M0–M6) are shipped.

| #  | Scope |
| -- | ----- |
| M0 | Scaffold: Astro project, CI (lint, typecheck, test), layout shell + design tokens, pipeline skeleton fetching one CoinGecko endpoint into `/data`, basic price chart, Pages deploy |
| M1 | Volatility & risk: rolling 30/90/365d realized vol, max drawdown curve, Sharpe/Sortino vs S&P 500 and gold |
| M2 | Halving cycles: price normalised to days-since-halving, four-cycle overlay, log scale toggle |
| M3 | Correlation: 90d rolling correlation matrix (BTC vs S&P 500, gold, DXY) with per-pair time-series view |
| M4 | DCA simulator: weekly/monthly DCA vs lump sum from arbitrary start date, fees included, fully client-side |
| M5 | Flows & dominance: BTC dominance vs stablecoin total supply; exchange netflow only if a free source exists, otherwise drop |
| M6 | Polish & ship: dark/light mode, live ticker island, OpenGraph cards, production deploy, and a README covering architecture, metric methodology, and a matter-of-fact "How this was built" section: Claude Code against a milestone plan, one PR per feature, fixture-tested metrics, human review at PR boundaries |

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
