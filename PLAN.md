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

### M16 — plan (revised after review)

M15 halved what a chart page costs and left three things measured but not
fixed. The first version of this plan led with moving each chart's inline JSON
to a fetched route. Review rejected that, and was right to; what follows is the
revised plan, with the original kept visible below because the reasoning is the
useful part.

**Order matters, and it changed.** Diagnosing the Lighthouse ceiling now runs
*first*, because its evidence decides whether the biggest item exists at all.

**A. Encode the payloads columnarly.** Every payload is an array of
`{date, price}` objects; the dates are strictly daily-contiguous (checked: all
5,824 rows of `btc-price-history.json`, and all four cycles). A start date plus
a values array is lossless and roughly halves it:

| payload | today | columnar | saving |
| --- | --- | --- | --- |
| `btcHistory.series` (`/dca`, `/holdings`) | 38.0 KB gz | **19.7 KB gz** | 49% |
| `halvingCycles` (`/cycles`) | 28.4 KB gz | **14.6 KB gz** | 49% |

No new fetch, no rule amendment, no new failure mode, and it composes with the
fetched-payload idea if that is ever justified. Pure encode/decode pair with
fixtures, asserted round-trip-exact against the committed data.

**B. Zero the upgrade layout shift** — measured CLS 0.0346 at 360px, 0.0085 at
1280px, against 0 before M15. The first plan said to measure the static chart's
displayed height and render the live one into it. That is wrong: the static SVG
is *scaled* by CSS, so its margins and type scale with it, while a live chart
rendered at the container's pixel width would have unscaled 48px margins and
11px text — an 11% narrower plot area and a third larger axis type, appearing
at the instant of hover. Zero CLS, visible shape change.

Instead: render the live chart at the **nominal width of whichever variant CSS
is showing** (400 or 760), and insert it inside a wrapper carrying that same
`.chart-at-*` class. CSS then scales it by exactly the factor it was already
scaling the static one by, so the box and the shape both stay put, and no
height is measured anywhere.

**C. Downsample the served SVG** — min/max per x-pixel bucket, build-time only;
the live chart keeps every point so a hovered figure is never an approximation.
Committed already as a pure function. Three invariants the wiring must respect,
none of them optional:
- Bucket **per series**, not across the flattened array — `CyclesChart` flattens
  four cycles into one array and Plot re-groups by `stroke`; bucketing the flat
  array would interleave four lines into one.
- Pin each series' first and last point: `lineEnds` drives the year labels, and
  a dropped last point floats a label off the end of its line.
- Emit each bucket's min and max in original x order, or the polyline doubles
  back inside the bucket — invisible at 1px, not once CSS scales 400 up to 608
  at the breakpoint.

Worth 21.8 → 18.0 KB gz on the narrow variant only (measured after coordinate
trimming, which already collapses some of the same redundancy); the wide
variant is already under two points per pixel. Less than A, so it goes after it.

**D. A failed upgrade is currently permanent.** `upgradeChart`'s `promote`
removes all three listeners before running and never re-adds them, so a
rejected render kills the crosshair for the rest of the page view. Today that
needs a cache-first hashed chunk to fail, which is close to impossible; it is
still wrong, and every other item here widens the window.

**E. Give B a gate.** `lighthouserc.json` audits no chart page except
`/holdings`, asserts no CLS, and never hovers — so the shift B fixes is
invisible to CI by construction. Add a scripted drive of `dist/` that hovers
each chart and records `layout-shift` entries, and run it in CI.

**Deferred, deliberately.**

*Fetching the payloads instead of inlining them* is not in this milestone. The
saving is real — the payload is 90% of `/holdings` and 61% of `/dca` — but it
splits the chart from its data: the page is network-first and the payload would
be cached independently, so after a pipeline commit a reader can hold a chart
drawn from one snapshot and a crosshair reporting another. That is "the chart
changing shape under the reader's cursor" arriving by a different door. If it
is revived it needs content-hashed URLs (which also puts it in the worker's
cache-first branch), the URL emitted as a build-time attribute rather than
derived in the client — deriving it is how a GBP reader gets USD figures under
a GBP-labelled chart — scalars kept inline on the two pages that read them
synchronously, a single shared asset for the history series `/dca` and
`/holdings` both embed, and the small pages excluded, since a round-trip costs
more than the 4.4 KB it would save on `/flows`. It also puts a request behind
the reader typing into the holdings form, which the privacy note would have to
be rewritten to admit. Its own PR, on its own evidence.

*Prefetching Plot at idle to restore the offline crosshair* is also deferred,
and the shape of the answer has changed: not a blanket idle prefetch — that
returns 88 KB to every first visit for the majority who never hover, and
`navigator.connection.saveData` cannot gate it because it does not exist in
Safari or Firefox. Gate it on the app being *installed* instead. Someone who
installed the PWA has opted into offline use; someone who opened a tab has not.

### M17-M21 — plan

M16 finished the performance work. What follows is scope, not cleanup: five
milestones, one PR each, in order. The ordering is deliberate — M17 exists
partly to start clocks that cannot be started retroactively, and M18 depends on
what M17 ingests.

**A probe ran before any of it** (`scripts/probe.ts`, since deleted; runs
30442380383 and 30442577892). Outbound network is blocked in the dev
environment, so every field name and chart slug below started as memory rather
than measurement, and this project has shipped confident prose the data
contradicted often enough that memory is not good enough to plan on. What
follows is what the endpoints actually returned on 2026-07-29.

It earned its place twice. The first run reported ETH coarsened to weekly bars
— but it asked with `range=max`, which `benchmarks.ts:193` documents as
deliberately never used precisely because Yahoo serves coarser bars for it.
That measured the parameter, not the ticker. And blockchain.com's own `period`
field turned out to be unreliable, which is only visible if you measure the
spacing instead of reading it.

#### Decisions taken before M17 (2026-07-29)

Four calls that change the work, recorded with their reasoning so the next
reader does not have to reconstruct them:

- **Correlation depth.** BTC-ETH gets the full depth the other BTC pairs have;
  ETH against S&P, gold and DXY keeps the 365d window. This extends M11's
  existing rule rather than inventing one, and bounds the growth of the largest
  page on the site.
- **ETH dominance is charted immediately**, not held back until the series is
  deep. It will be a very short line at first — that is honest about when
  capture started, and the alternative is a page that quietly waits months.
- **The /dca layout shift is its own PR, before M17**, so a rendering fix does
  not ride along inside a data milestone.
- **ETH in the GBP tree is quoted natively** (`ETH-GBP`), not converted through
  the committed FX series. This is a deliberate departure: every other figure in
  that tree is a re-denomination of one USD source, so ETH becomes the only
  series whose GBP value comes from its own market rather than a cross-rate.
  The reasoning for it is that a GBP holder's ETH really does trade in GBP.
  Two consequences must be handled rather than absorbed: the methodology page
  has to say plainly that BTC is converted and ETH is not, and the pipeline
  should assert that the native and converted figures stay within a stated
  band, so a divergence surfaces as a data-quality signal instead of as two
  numbers that quietly disagree.

#### M17 — widen what we ingest

The pipeline already calls CoinGecko's `/global`, and
`coingeckoGlobalSchema` keeps exactly two fields from it:
`total_market_cap.usd` and `market_cap_percentage.btc`. The same response
carries the rest of `market_cap_percentage` and `total_volume.usd`. Capturing
them costs no new request.

- **ETH dominance**, and the **stablecoin share** of total market cap
  (`usdt + usdc`), which pairs with the stablecoin supply chart already on
  `/flows`.
- **Aggregate 24h volume**, and volume over market cap as a turnover ratio.
**Measured:** all four wanted keys are present — `btc`, `eth`, `usdt`, `usdc`
(alongside `xrp`, `sol`, `trx`, `steth` and others), plus `total_volume.usd`
and `market_cap_change_percentage_24h_usd`. The premise holds.

- **ETH as a benchmark asset** — `ETH-USD` through the existing
  `fetchYahooDaily(tickers)` helper, the same path gold and DXY already take.
  This is option A of the ETH question: ETH becomes a fifth benchmark, not a
  second asset tree. It then appears in the correlation matrix and the
  risk-adjusted comparison table without either page changing.

  **Measured at the repo's own parameters** (`range=10y&interval=1d`):
  `ETH-USD` 3,185 daily points from 2017-11-09, `ETH=F` 1,380 from 2021-02-05.
  Daily, not coarsened.

  **And a decision the probe surfaced:** `ETH-GBP` also exists and is daily
  (3,183 points from 2017-11-11). The GBP tree could take ETH natively instead
  of converting USD through the committed FX series. This paragraph originally
  argued against it and concluded "M17 should convert like everything else and
  say so" — which the Decisions section above overrules, and which is left here
  corrected rather than deleted because the reasoning against it is still the
  reason the divergence check exists. ETH *is* quoted natively, and the spread
  the paragraph worried about was then measured rather than argued about: over
  the 3,183 days the two series share, the committed check reports a median gap
  of 0.182%, p95 0.716%, worst day 2.910% (2022-09-29). The build fails if the
  median passes 1% and only reports the worst day. (The probe that justified the
  band said 0.174% over 2,531 days, because it required an exact FX quote where
  the pipeline carries Friday's rate across the weekend like every other
  conversion. The committed figures are the ones the page and the tests quote.)

**Why first, and why not deferred:** dominance history is pro-only on the
keyless tier, so `data/dominance.json` accretes one snapshot per UTC day — it
holds three points today. Every day these fields are not captured is a day of
history that cannot be recovered later. The charts can come afterwards; the
capture cannot.

**Shipped.** A second probe ran before the code, because two things this plan
assumed were not measured (run 30456674325):

- **How Yahoo dates a crypto bar.** BTC is shifted back a day before
  correlation because a CoinGecko snapshot dated *d* is the close of *d−1*.
  Yahoo turns out to date a crypto bar by the day it covers: against the
  committed series over 365 overlapping days, Yahoo BTC-USD dated *d* matched
  CoinGecko dated *d+1* to a median 0.019% (p95 0.114%), against 1.285% at lag 0
  and 1.946% at lag −1. So ETH is already session-dated and takes no shift.
  Shifting it would have put back exactly the offset the BTC shift removes, and
  would have shown up as BTC and ETH looking less alike than they are.
- **The native-vs-converted band**, above.

And what it cost, measured against `main` rather than estimated:

| | main | M17 | after codec |
|---|---|---|---|
| `/correlation` gz | 58,889 | 74,841 | **66,087** |
| `correlations.json` | 640 KB | 940 KB | — |
| pairs | 6 | 10 | 10 |

The M16 codec halved the growth rather than absorbing it: net +7,198 bytes gz,
+12%. It helps exactly one pair, because `btc-eth` is crypto against crypto and
is the only daily-contiguous series in the file (3,144 readings over 3,144
days); every other pair is trading-day based and stores its dates. Ten toggle
buttons in one non-wrapping row also made `/correlation` 565px wide in a 412px
viewport — a regression against `main`, which measures 412 — fixed by wrapping.
`/correlation` is now audited: 0.98 performance, 0.0000 CLS over five mobile
runs.

**The cost to plan for, not discover:** a fifth benchmark takes the correlation
matrix from 6 pairs to 10. `correlations.json` is already 640 KB and
`/correlation` is already the largest page on the site at 54 KB gz, 77% of it
payload, and the columnar codec cannot compact it because its dates are
trading-day-based. M17 must decide pair depth explicitly rather than let the
file grow — most likely by extending M11's existing rule that pairs without BTC
keep the shorter window.

#### M18 — rebased performance comparison

The site commits daily S&P 500, gold and DXY series and never plots them:
`benchmarks-daily.json` is read for one footnote about gold's source and for
correlation maths. It computes how BTC *co-moves* with those assets and never
shows how it *performed* against them.

A rebased chart — every series indexed to 100 at a chosen start, log toggle,
ETH included once M17 lands. Pure `rebase()` function with fixtures. The start
date is the reader's choice, which makes it the second chart after DCA whose
shape is chosen at runtime, so it follows the same build-renders-the-default
pattern.

#### M19 — network history

`/network` shows live fee tiers with no historical context at all — the one
page where a reader can see today's number and nothing to judge it against.
`fetchChart(slug)` on blockchain.com is already generic over slug, with the
same response shape, parser and validation, so each series is one argument:

**Measured — and the response's own `period` field cannot be trusted.** Daily
at 1,091-1,095 points over three years, so they drop straight into the existing
`fetchChart` path:

- `transaction-fees` (unit BTC) and `transaction-fees-usd` (unit USD) — fee
  history under the live tiers. Two variants; the USD one is directly
  comparable to what a reader pays, the BTC one is not currency-dependent.
- `miners-revenue` (USD), `difficulty`, `n-unique-addresses`, `avg-block-size`.

Two are **not** daily and need aggregating in the pipeline before they could be
committed, which is exactly the kind of thing that is unpleasant to discover
mid-milestone:

- `mempool-size` — reports `period=minute`, measured **15-minute** spacing,
  105,029 points.
- `total-bitcoins` — reports `period=day` and is measured at **6 minutes**,
  144,506 points. The metadata is simply wrong, so any consumer must measure.

M19 should take the daily four and treat mempool size as a separate decision
with a stated downsampling rule, not fold it in silently.

#### M20 — real returns

`parseFredCsv(text, id)` is generic over FRED series id, so `CPIAUCSL` (US CPI)
is one more id through tested code. **Measured:** header
`observation_date,CPIAUCSL`, 954 rows, 1947-01-01 to 2026-06-01 — **monthly**,
and lagging the present by a month or two. Joining a monthly, revised, lagging
index to a daily price series needs a documented rule, the same class of
decision as M9's FX carry-forward, and the deflator's base period has to be
stated on the page or the figures mean nothing. That buys inflation-adjusted BTC returns —
a figure most Bitcoin dashboards do not show, on a site that already holds the
full price history and the risk machinery to compute it. Nominal and real side
by side, with the deflator and base period stated.

#### M21 — holding-period matrix

Buy in year X, sell in year Y, as a triangular heatmap reusing the monthly
heatmap's colour system. Pure maths over committed history. It answers "did
entry timing actually matter" better than any other single visual, and it
subsumes several smaller ideas (best/worst windows, time-to-recovery framing).

#### Carried, and not forgotten

Three items from M15/M16 that are real and unscheduled:

- ~~`/dca`'s 0.0895 layout shift~~ — **done**, in the PR that carried this
  plan. The stat tiles *and* the legend are server-rendered from the defaults
  the build already simulates; `/dca` and `/gbp/dca` are now audited and assert
  CLS at or under 0.02, measured 0.0025 at 412px and 0 at 1280px.
- `downsample.ts` ships tested and **unwired**. Wiring needs per-series
  bucketing and pinned series endpoints. `/correlation` is now the page that
  would gain most: `btc-eth` carries 3,144 readings drawn at 760px, four per
  pixel. The obstacle is the crosshair, which reads its anchors from the same
  array, so downsampling the payload coarsens the readout.
- **Offset dates in the series codec**, measured during M17 and deliberately not
  taken there. Storing a gapped series as a start date plus day-offsets, instead
  of falling back to plain rows, is worth a further 3,270 bytes gz on
  `/correlation` alone. It changes a codec four components share, so it wants
  its own PR and its own round-trip tests rather than riding inside a data
  milestone.
- **Fetched payloads** stay deferred, with the seven preconditions recorded
  above. `/correlation` is the page that would benefit and the one where the
  atomicity risk is sharpest, since its regime bands and its tables come from
  the same file.

Two quality gates worth their own milestone eventually, both justified by this
repo's own history rather than by principle: a test that extracts figures from
rendered page copy and asserts them against `/data` (this project has shipped
prose the data contradicted at least six times), and visual-regression
snapshots (two silent visual regressions shipped in one session — 4.6px axis
type on phones, and a printed chart contradicting its own labels — with lint,
typecheck, unit tests and Lighthouse all green on both).

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
